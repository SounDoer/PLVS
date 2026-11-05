//! WASAPI speaker positions for the exact cpal endpoint, not a device-name match.
use super::source_layout::{wave_roles, NativeLayout};
use cpal::traits::DeviceTrait;
use windows::core::PCWSTR;
use windows::Win32::Media::Audio::{
  IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator, WAVEFORMATEXTENSIBLE,
};
use windows::Win32::System::Com::{
  CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

pub(crate) fn read_device(
  device: &cpal::Device,
  channels: u16,
  output: bool,
) -> Option<NativeLayout> {
  read_roles(device.id().ok()?.id(), channels, output)
}

fn read_roles(endpoint: &str, channels: u16, output: bool) -> Option<NativeLayout> {
  // This closure is called on the PCM consumer thread. COM must be initialized there.
  unsafe {
    CoInitializeEx(None, COINIT_MULTITHREADED).ok().ok()?;
    let result = (|| -> Option<NativeLayout> {
      let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
      let id: Vec<u16> = endpoint.encode_utf16().chain(Some(0)).collect();
      let device = enumerator.GetDevice(PCWSTR(id.as_ptr())).ok()?;
      let client: IAudioClient = device.Activate(CLSCTX_ALL, None).ok()?;
      let format = client.GetMixFormat().ok()?;
      if format.is_null() {
        return None;
      }
      let roles = if (*format).nChannels != channels {
        None
      } else if (*format).wFormatTag == 0xfffe
        && usize::from((*format).cbSize)
          >= std::mem::size_of::<WAVEFORMATEXTENSIBLE>() - std::mem::size_of_val(&*format)
      {
        let extended = format.cast::<WAVEFORMATEXTENSIBLE>();
        let mask = std::ptr::addr_of!((*extended).dwChannelMask).read_unaligned();
        let roles = if mask == 0 {
          Some(vec!["generic".into(); usize::from(channels)])
        } else {
          wave_roles(mask, channels)
        };
        roles.map(|roles| NativeLayout {
          roles,
          speakers: output.then(|| {
            (0..if mask == 0 {
              usize::from(channels)
            } else {
              mask.count_ones() as usize
            })
              .collect()
          }),
        })
      } else {
        let roles = match channels {
          1 => vec!["M".into()],
          2 => vec!["L".into(), "R".into()],
          _ => vec!["generic".into(); usize::from(channels)],
        };
        Some(NativeLayout {
          roles,
          speakers: output.then(|| (0..usize::from(channels)).collect()),
        })
      };
      CoTaskMemFree(Some(format.cast()));
      roles
    })();
    CoUninitialize();
    result
  }
}
