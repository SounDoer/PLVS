//! WASAPI speaker positions for the exact cpal endpoint, not a device-name match.
use super::source_layout::{wave_layout, NativeLayout};
use cpal::traits::DeviceTrait;
use windows::core::PCWSTR;
use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
use windows::Win32::Media::Audio::{
  IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, PKEY_AudioEndpoint_PhysicalSpeakers,
  WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToUInt32};
use windows::Win32::System::Com::{
  CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
  COINIT_MULTITHREADED, STGM_READ,
};

pub(crate) fn read_device(
  device: &cpal::Device,
  channels: u16,
  output: bool,
) -> Option<NativeLayout> {
  read_roles(device.id().ok()?.id(), channels, output, false)
}

pub(crate) fn read_capture_device(
  device: &cpal::Device,
  channels: u16,
  output: bool,
) -> Option<NativeLayout> {
  read_roles(device.id().ok()?.id(), channels, output, true)
}

// CPAL initializes STA on the calling thread. Reuse that apartment instead of treating the
// MTA/STA mismatch as missing device metadata; balance only our own successful initialization.
fn initialize_com() -> Option<bool> {
  let status = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
  if status.is_ok() {
    Some(true)
  } else if status == RPC_E_CHANGED_MODE {
    Some(false)
  } else {
    None
  }
}

fn read_roles(
  endpoint: &str,
  channels: u16,
  output: bool,
  diagnostics: bool,
) -> Option<NativeLayout> {
  // Called on an ordinary discovery/capture worker. COM must be initialized on that thread.
  unsafe {
    let uninitialize = initialize_com()?;
    let result = (|| -> Option<NativeLayout> {
      let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
      let id: Vec<u16> = endpoint.encode_utf16().chain(Some(0)).collect();
      let device = enumerator.GetDevice(PCWSTR(id.as_ptr())).ok()?;
      let configured_mask = if output {
        device
          .OpenPropertyStore(STGM_READ)
          .ok()
          .and_then(|store| store.GetValue(&PKEY_AudioEndpoint_PhysicalSpeakers).ok())
          .and_then(|mut value| {
            let result = PropVariantToUInt32(&value).ok();
            let _ = PropVariantClear(&mut value);
            result
          })
      } else {
        None
      };
      let client: IAudioClient = device.Activate(CLSCTX_ALL, None).ok()?;
      let format = client.GetMixFormat().ok()?;
      if format.is_null() {
        return None;
      }
      let mask = if (*format).wFormatTag == 0xfffe
        && usize::from((*format).cbSize)
          >= std::mem::size_of::<WAVEFORMATEXTENSIBLE>() - std::mem::size_of_val(&*format)
      {
        let extended = format.cast::<WAVEFORMATEXTENSIBLE>();
        std::ptr::addr_of!((*extended).dwChannelMask).read_unaligned()
      } else {
        match (*format).nChannels {
          1 => 4,
          2 => 3,
          _ => 0,
        }
      };
      let mix_channels = (*format).nChannels;
      let roles = (mix_channels == channels)
        .then(|| wave_layout(mask, channels, configured_mask, output))
        .flatten();
      if diagnostics {
        log::info!(
          "Windows capture layout endpoint={endpoint} output={output} requested_channels={channels} mix_channels={mix_channels} mix_mask={mask:#x} configured_mask={configured_mask:?} resolved={roles:?}"
        );
      }
      CoTaskMemFree(Some(format.cast()));
      roles
    })();
    if uninitialize {
      CoUninitialize();
    }
    result
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use windows::Win32::System::Com::COINIT_APARTMENTTHREADED;

  #[test]
  fn discovery_reuses_cpals_sta_without_uninitializing_it() {
    std::thread::spawn(|| unsafe {
      CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
      assert_eq!(initialize_com(), Some(false));
      assert_eq!(
        CoInitializeEx(None, COINIT_MULTITHREADED),
        RPC_E_CHANGED_MODE
      );
      CoUninitialize();
    })
    .join()
    .unwrap();
  }

  #[test]
  fn fresh_worker_initialization_is_balanced() {
    std::thread::spawn(|| unsafe {
      assert_eq!(initialize_com(), Some(true));
      CoUninitialize();
      CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
      CoUninitialize();
    })
    .join()
    .unwrap();
  }
}
