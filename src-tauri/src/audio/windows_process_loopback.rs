//! Experimental Windows process-loopback capture.
//!
//! This is deliberately not wired into the product device picker yet. It exists to validate
//! isolation and meter parity on real Windows audio stacks before the source model becomes a
//! persisted public contract.

use std::mem::{size_of, ManuallyDrop};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use windows62::core::{implement, IUnknown, Interface, Ref};
use windows62::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows62::Win32::Media::Audio::{
  ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
  IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
  IAudioCaptureClient, IAudioClient, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
  AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
  AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
  AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
  AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
  PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
  WAVEFORMATEX,
};
use windows62::Win32::System::Com::StructuredStorage::{
  PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows62::Win32::System::Com::{CoInitializeEx, CoUninitialize, BLOB, COINIT_MULTITHREADED};
use windows62::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
use windows62::Win32::System::Variant::VT_BLOB;

use crate::dsp::summary_meter::{SummaryMeter, SummaryMetrics};

const SAMPLE_RATE: u32 = 48_000;
const CHANNELS: u16 = 2;
const BITS_PER_SAMPLE: u16 = 32;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(5);

/// Result of one process-loopback probe run.
#[derive(Debug, Clone)]
pub struct ProcessLoopbackProbeResult {
  pub process_id: u32,
  pub sample_rate_hz: u32,
  pub channel_count: u16,
  pub captured_frames: u64,
  pub silent_frames: u64,
  pub metrics: SummaryMetrics,
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct CompletionHandler(mpsc::Sender<windows62::core::Result<IUnknown>>);

impl IActivateAudioInterfaceCompletionHandler_Impl for CompletionHandler_Impl {
  fn ActivateCompleted(
    &self,
    operation: Ref<'_, IActivateAudioInterfaceAsyncOperation>,
  ) -> windows62::core::Result<()> {
    let result = operation.ok().and_then(retrieve_activation_result);
    let _ = self.0.send(result);
    Ok(())
  }
}

fn retrieve_activation_result(
  operation: &IActivateAudioInterfaceAsyncOperation,
) -> windows62::core::Result<IUnknown> {
  let mut activation_result = windows62::core::HRESULT::default();
  let mut interface = None;
  unsafe {
    operation.GetActivateResult(&mut activation_result, &mut interface)?;
  }
  activation_result.ok()?;
  interface.ok_or_else(|| windows62::core::Error::from(activation_result))
}

struct ComApartment;

impl ComApartment {
  fn initialize() -> Result<Self, String> {
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
      .ok()
      .map_err(|error| format!("CoInitializeEx failed: {error}"))?;
    Ok(Self)
  }
}

impl Drop for ComApartment {
  fn drop(&mut self) {
    unsafe { CoUninitialize() };
  }
}

struct EventHandle(windows62::Win32::Foundation::HANDLE);

impl EventHandle {
  fn create() -> Result<Self, String> {
    let handle = unsafe { CreateEventW(None, false, false, None) }
      .map_err(|error| format!("CreateEventW failed: {error}"))?;
    Ok(Self(handle))
  }
}

impl Drop for EventHandle {
  fn drop(&mut self) {
    unsafe {
      let _ = CloseHandle(self.0);
    }
  }
}

struct ActivationPayload {
  _params: Box<AUDIOCLIENT_ACTIVATION_PARAMS>,
  // `PROPVARIANT` owns VT_BLOB memory by convention and its Rust Drop calls PropVariantClear.
  // Here the blob only borrows our boxed params, so suppress that deallocator explicitly.
  variant: ManuallyDrop<PROPVARIANT>,
}

impl ActivationPayload {
  fn new(process_id: u32) -> Self {
    let mut params = Box::new(AUDIOCLIENT_ACTIVATION_PARAMS {
      ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
      Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
        ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
          TargetProcessId: process_id,
          ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
        },
      },
    });
    let variant = ManuallyDrop::new(PROPVARIANT {
      Anonymous: PROPVARIANT_0 {
        Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
          vt: VT_BLOB,
          wReserved1: 0,
          wReserved2: 0,
          wReserved3: 0,
          Anonymous: PROPVARIANT_0_0_0 {
            blob: BLOB {
              cbSize: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
              pBlobData: (&mut *params as *mut AUDIOCLIENT_ACTIVATION_PARAMS).cast(),
            },
          },
        }),
      },
    });
    Self {
      _params: params,
      variant,
    }
  }
}

fn activate_process_audio_client(process_id: u32) -> Result<IAudioClient, String> {
  // The variant points into the boxed parameters; keep the payload alive until the callback.
  let payload = ActivationPayload::new(process_id);
  let (tx, rx) = mpsc::channel();
  let handler: IActivateAudioInterfaceCompletionHandler = CompletionHandler(tx).into();
  unsafe {
    ActivateAudioInterfaceAsync(
      VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
      &IAudioClient::IID,
      Some(&*payload.variant),
      &handler,
    )
  }
  .map_err(|error| format!("ActivateAudioInterfaceAsync failed: {error}"))?;

  rx.recv_timeout(ACTIVATION_TIMEOUT)
    .map_err(|_| "timed out waiting for process-loopback activation".to_string())?
    .map_err(|error| format!("process-loopback activation failed: {error}"))?
    .cast()
    .map_err(|error| format!("activated interface is not IAudioClient: {error}"))
}

fn capture_format() -> WAVEFORMATEX {
  let block_align = CHANNELS * (BITS_PER_SAMPLE / 8);
  WAVEFORMATEX {
    wFormatTag: WAVE_FORMAT_IEEE_FLOAT,
    nChannels: CHANNELS,
    nSamplesPerSec: SAMPLE_RATE,
    nAvgBytesPerSec: SAMPLE_RATE * u32::from(block_align),
    nBlockAlign: block_align,
    wBitsPerSample: BITS_PER_SAMPLE,
    cbSize: 0,
  }
}

/// Capture the target process tree for `duration` and run it through PLVS's summary meter.
///
/// Windows returns silence when the process tree has no shared-mode render streams. ASIO and
/// exclusive-mode streams bypass this API and therefore cannot be measured by this probe.
pub fn capture_process_to_summary(
  process_id: u32,
  duration: Duration,
) -> Result<ProcessLoopbackProbeResult, String> {
  if process_id == 0 {
    return Err("process id must be non-zero".to_string());
  }
  if duration.is_zero() {
    return Err("capture duration must be non-zero".to_string());
  }

  let _com = ComApartment::initialize()?;
  let audio_client = activate_process_audio_client(process_id)?;
  let format = capture_format();
  unsafe {
    audio_client.Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK
        | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
        | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
        | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
      200_000,
      0,
      &format,
      None,
    )
  }
  .map_err(|error| format!("IAudioClient::Initialize failed: {error}"))?;

  let event = EventHandle::create()?;
  unsafe { audio_client.SetEventHandle(event.0) }
    .map_err(|error| format!("IAudioClient::SetEventHandle failed: {error}"))?;
  let capture_client: IAudioCaptureClient = unsafe { audio_client.GetService() }
    .map_err(|error| format!("IAudioClient::GetService failed: {error}"))?;

  let mut meter = SummaryMeter::new(SAMPLE_RATE, CHANNELS);
  let mut silent_samples = Vec::new();
  let mut captured_frames = 0u64;
  let mut silent_frames = 0u64;
  let deadline = Instant::now() + duration;
  unsafe { audio_client.Start() }
    .map_err(|error| format!("IAudioClient::Start failed: {error}"))?;

  let capture_result = (|| {
    while Instant::now() < deadline {
      let remaining = deadline.saturating_duration_since(Instant::now());
      let wait_ms = remaining.as_millis().clamp(1, 100) as u32;
      let wait = unsafe { WaitForSingleObject(event.0, wait_ms) };
      if wait == WAIT_TIMEOUT {
        continue;
      }
      if wait != WAIT_OBJECT_0 {
        return Err(format!("WaitForSingleObject failed with status {}", wait.0));
      }

      loop {
        let packet_frames = unsafe { capture_client.GetNextPacketSize() }
          .map_err(|error| format!("GetNextPacketSize failed: {error}"))?;
        if packet_frames == 0 {
          break;
        }

        let mut data = std::ptr::null_mut();
        let mut frames = 0u32;
        let mut flags = 0u32;
        unsafe { capture_client.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }
          .map_err(|error| format!("GetBuffer failed: {error}"))?;

        let sample_count = frames as usize * CHANNELS as usize;
        if (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 {
          silent_samples.resize(sample_count, 0.0);
          meter.push_interleaved(&silent_samples);
          silent_frames += u64::from(frames);
        } else {
          let samples = unsafe { std::slice::from_raw_parts(data.cast::<f32>(), sample_count) };
          meter.push_interleaved(samples);
        }
        captured_frames += u64::from(frames);
        unsafe { capture_client.ReleaseBuffer(frames) }
          .map_err(|error| format!("ReleaseBuffer failed: {error}"))?;
      }
    }
    Ok(())
  })();

  let stop_result =
    unsafe { audio_client.Stop() }.map_err(|error| format!("IAudioClient::Stop failed: {error}"));
  capture_result?;
  stop_result?;

  Ok(ProcessLoopbackProbeResult {
    process_id,
    sample_rate_hz: SAMPLE_RATE,
    channel_count: CHANNELS,
    captured_frames,
    silent_frames,
    metrics: meter.finish(),
  })
}

#[cfg(test)]
mod tests {
  use super::{capture_format, ActivationPayload};
  use windows62::Win32::Media::Audio::{
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
  };
  use windows62::Win32::System::Variant::VT_BLOB;

  #[test]
  fn activation_blob_targets_the_requested_process_tree() {
    let payload = ActivationPayload::new(42);
    assert_eq!(
      payload._params.ActivationType,
      AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
    );
    let loopback = unsafe { payload._params.Anonymous.ProcessLoopbackParams };
    assert_eq!(loopback.TargetProcessId, 42);
    assert_eq!(
      loopback.ProcessLoopbackMode,
      PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE
    );
    let inner = unsafe { &*payload.variant.Anonymous.Anonymous };
    assert_eq!(inner.vt, VT_BLOB);
    let blob = unsafe { inner.Anonymous.blob };
    assert_eq!(
      blob.cbSize as usize,
      std::mem::size_of_val(&*payload._params)
    );
    assert_eq!(blob.pBlobData, (&*payload._params as *const _ as *mut _));
  }

  #[test]
  fn probe_requests_float32_stereo_at_48khz() {
    let format = capture_format();
    let channels = format.nChannels;
    let sample_rate = format.nSamplesPerSec;
    let bits_per_sample = format.wBitsPerSample;
    let block_align = format.nBlockAlign;
    assert_eq!(channels, 2);
    assert_eq!(sample_rate, 48_000);
    assert_eq!(bits_per_sample, 32);
    assert_eq!(block_align, 8);
  }
}
