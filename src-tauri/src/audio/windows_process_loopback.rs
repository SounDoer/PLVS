//! Experimental Windows process-loopback capture.
//!
//! This is deliberately not wired into the product device picker yet. It exists to validate
//! isolation and meter parity on real Windows audio stacks before the source model becomes a
//! persisted public contract.

use std::mem::{size_of, ManuallyDrop};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use tauri::AppHandle;
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
  WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
};
use windows62::Win32::System::Com::StructuredStorage::{
  PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows62::Win32::System::Com::{CoInitializeEx, CoUninitialize, BLOB, COINIT_MULTITHREADED};
use windows62::Win32::System::Threading::{CreateEventW, WaitForSingleObject};
use windows62::Win32::System::Variant::VT_BLOB;

use super::capture::{AudioCaptureSession, MeasuredPcmSubscriptions};
use super::cpal_backend::{
  emit_capture_failure, pooled_pcm_buffer_capacity, run_meter_pipeline_bridge_thread,
  PcmBufferPool, PcmCallbackForwarder, PcmDeliveryQueue, PCM_QUEUE_CAP,
};
use crate::dsp::speech::VadEngineKind;
use crate::dsp::summary_meter::{SummaryMeter, SummaryMetrics};
use crate::ipc::commands::ChannelSelection;
use crate::ipc::types::FrameSubscribers;

const DEFAULT_SAMPLE_RATE: u32 = 48_000;
const DEFAULT_CHANNELS: u16 = 2;
const BITS_PER_SAMPLE: u16 = 32;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: windows62::core::GUID =
  windows62::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
const ACTIVATION_TIMEOUT: Duration = Duration::from_secs(5);

/// Result of one process-loopback probe run.
#[derive(Debug, Clone)]
pub struct ProcessLoopbackProbeResult {
  pub process_id: u32,
  pub sample_rate_hz: u32,
  pub channel_count: u16,
  pub captured_frames: u64,
  pub silent_frames: u64,
  pub channel_peak_dbfs: Vec<f64>,
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

enum CaptureFormat {
  Basic(WAVEFORMATEX),
  Extensible(WAVEFORMATEXTENSIBLE),
}

impl CaptureFormat {
  fn as_ptr(&self) -> *const WAVEFORMATEX {
    match self {
      Self::Basic(format) => format,
      Self::Extensible(format) => std::ptr::addr_of!(format.Format),
    }
  }
}

fn channel_mask(channels: u16) -> Option<u32> {
  match channels {
    // Windows speaker masks: mono FC; stereo FL/FR; 5.1 side; 7.1 surround.
    1 => Some(0x0004),
    2 => Some(0x0003),
    6 => Some(0x060f),
    8 => Some(0x063f),
    _ => None,
  }
}

fn capture_format(sample_rate: u32, channels: u16) -> Result<CaptureFormat, String> {
  if !(8_000..=384_000).contains(&sample_rate) {
    return Err(format!("unsupported probe sample rate: {sample_rate}"));
  }
  let mask = channel_mask(channels)
    .ok_or_else(|| format!("unsupported probe channel count: {channels} (use 1, 2, 6, or 8)"))?;
  let block_align = channels * (BITS_PER_SAMPLE / 8);
  let base = WAVEFORMATEX {
    wFormatTag: if channels <= 2 {
      WAVE_FORMAT_IEEE_FLOAT
    } else {
      WAVE_FORMAT_EXTENSIBLE
    },
    nChannels: channels,
    nSamplesPerSec: sample_rate,
    nAvgBytesPerSec: sample_rate * u32::from(block_align),
    nBlockAlign: block_align,
    wBitsPerSample: BITS_PER_SAMPLE,
    cbSize: if channels <= 2 { 0 } else { 22 },
  };
  if channels <= 2 {
    Ok(CaptureFormat::Basic(base))
  } else {
    Ok(CaptureFormat::Extensible(WAVEFORMATEXTENSIBLE {
      Format: base,
      Samples: WAVEFORMATEXTENSIBLE_0 {
        wValidBitsPerSample: BITS_PER_SAMPLE,
      },
      dwChannelMask: mask,
      SubFormat: KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
    }))
  }
}

fn db_from_linear(value: f64) -> f64 {
  if value > 0.0 {
    20.0 * value.log10()
  } else {
    f64::NEG_INFINITY
  }
}

fn drain_process_packets(
  capture_client: &IAudioCaptureClient,
  channels: u16,
  forwarder: &PcmCallbackForwarder,
  silent_samples: &mut Vec<f32>,
) -> Result<(), String> {
  loop {
    let packet_frames = unsafe { capture_client.GetNextPacketSize() }
      .map_err(|error| format!("GetNextPacketSize failed: {error}"))?;
    if packet_frames == 0 {
      return Ok(());
    }

    let mut data = std::ptr::null_mut();
    let mut frames = 0u32;
    let mut flags = 0u32;
    unsafe { capture_client.GetBuffer(&mut data, &mut frames, &mut flags, None, None) }
      .map_err(|error| format!("GetBuffer failed: {error}"))?;

    let sample_count = frames as usize * channels as usize;
    if (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 {
      silent_samples.resize(sample_count, 0.0);
      forwarder.forward_f32(silent_samples);
    } else {
      let samples = unsafe { std::slice::from_raw_parts(data.cast::<f32>(), sample_count) };
      forwarder.forward_f32(samples);
    }
    unsafe { capture_client.ReleaseBuffer(frames) }
      .map_err(|error| format!("ReleaseBuffer failed: {error}"))?;
  }
}

fn run_process_stream(
  process_id: u32,
  sample_rate: u32,
  channels: u16,
  stop_rx: mpsc::Receiver<()>,
  forwarder: PcmCallbackForwarder,
) -> Result<(), String> {
  let _com = ComApartment::initialize()?;
  let audio_client = activate_process_audio_client(process_id)?;
  let format = capture_format(sample_rate, channels)?;
  unsafe {
    audio_client.Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK
        | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
        | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
        | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
      200_000,
      0,
      format.as_ptr(),
      None,
    )
  }
  .map_err(|error| format!("IAudioClient::Initialize failed: {error}"))?;

  let event = EventHandle::create()?;
  unsafe { audio_client.SetEventHandle(event.0) }
    .map_err(|error| format!("IAudioClient::SetEventHandle failed: {error}"))?;
  let capture_client: IAudioCaptureClient = unsafe { audio_client.GetService() }
    .map_err(|error| format!("IAudioClient::GetService failed: {error}"))?;
  unsafe { audio_client.Start() }
    .map_err(|error| format!("IAudioClient::Start failed: {error}"))?;

  let mut silent_samples = Vec::new();
  let capture_result = loop {
    match stop_rx.try_recv() {
      Ok(()) | Err(mpsc::TryRecvError::Disconnected) => break Ok(()),
      Err(mpsc::TryRecvError::Empty) => {}
    }
    let wait = unsafe { WaitForSingleObject(event.0, 100) };
    if wait == WAIT_TIMEOUT {
      continue;
    }
    if wait != WAIT_OBJECT_0 {
      break Err(format!("WaitForSingleObject failed with status {}", wait.0));
    }
    if let Err(error) =
      drain_process_packets(&capture_client, channels, &forwarder, &mut silent_samples)
    {
      break Err(error);
    }
  };
  let stop_result =
    unsafe { audio_client.Stop() }.map_err(|error| format!("IAudioClient::Stop failed: {error}"));
  capture_result?;
  stop_result
}

/// A production-shaped process-loopback session feeding the same meter bridge as device capture.
pub struct ProcessLoopbackSession {
  stop_tx: mpsc::Sender<()>,
  join: Option<std::thread::JoinHandle<Result<(), String>>>,
  clear_peak_history: Arc<AtomicBool>,
  reset_tp_max: Arc<AtomicBool>,
}

impl Drop for ProcessLoopbackSession {
  fn drop(&mut self) {
    let _ = self.stop_tx.send(());
    if let Some(join) = self.join.take() {
      let _ = join.join();
    }
  }
}

impl AudioCaptureSession for ProcessLoopbackSession {
  fn request_clear_peak_history(&self) {
    self.clear_peak_history.store(true, Ordering::Release);
  }

  fn request_reset_true_peak_max(&self) {
    self.reset_tp_max.store(true, Ordering::Release);
  }
}

#[allow(clippy::too_many_arguments)]
pub fn start_process_session(
  process_id: u32,
  sample_rate: u32,
  channels: u16,
  frame_subscribers: FrameSubscribers,
  app: AppHandle,
  channel_selection: Arc<std::sync::Mutex<Option<ChannelSelection>>>,
  dialogue_gating: Arc<std::sync::Mutex<bool>>,
  dialogue_vad_engine: Arc<std::sync::Mutex<VadEngineKind>>,
  measured_pcm: Arc<MeasuredPcmSubscriptions>,
) -> Result<Box<dyn AudioCaptureSession>, String> {
  if process_id == 0 {
    return Err("process id must be non-zero".to_string());
  }
  capture_format(sample_rate, channels)?;
  let (stop_tx, stop_rx) = mpsc::channel();
  let clear_peak_history = Arc::new(AtomicBool::new(false));
  let reset_tp_max = Arc::new(AtomicBool::new(false));
  let clear_for_bridge = clear_peak_history.clone();
  let reset_for_bridge = reset_tp_max.clone();
  let failure_app = app.clone();

  let join = std::thread::Builder::new()
    .name("process-capture".into())
    .spawn(move || {
      let dropped_chunks = Arc::new(AtomicU64::new(0));
      let pool = PcmBufferPool::new(
        PCM_QUEUE_CAP + 1,
        pooled_pcm_buffer_capacity(sample_rate, channels),
      );
      let bridge_pool = pool.clone();
      let cleanup_pool = pool.clone();
      let delivery = PcmDeliveryQueue::new(PCM_QUEUE_CAP);
      let bridge_delivery = delivery.clone();
      let cleanup_delivery = delivery.clone();
      let bridge_dropped = dropped_chunks.clone();
      let bridge = std::thread::spawn(move || {
        run_meter_pipeline_bridge_thread(
          bridge_delivery,
          sample_rate,
          channels,
          frame_subscribers,
          app,
          clear_for_bridge,
          reset_for_bridge,
          channel_selection,
          dialogue_gating,
          dialogue_vad_engine,
          measured_pcm,
          bridge_dropped,
          bridge_pool,
        );
        cleanup_delivery.consumer_finished(&cleanup_pool);
      });
      let forwarder = PcmCallbackForwarder::new(delivery.producer(), pool, dropped_chunks);
      let result = run_process_stream(process_id, sample_rate, channels, stop_rx, forwarder);
      delivery.stop_producer();
      let _ = bridge.join();
      if let Err(error) = &result {
        emit_capture_failure(&failure_app, error);
      }
      result
    })
    .map_err(|error| error.to_string())?;

  Ok(Box::new(ProcessLoopbackSession {
    stop_tx,
    join: Some(join),
    clear_peak_history,
    reset_tp_max,
  }))
}

/// Capture the target process tree for `duration` and run it through PLVS's summary meter.
///
/// Windows returns silence when the process tree has no shared-mode render streams. ASIO and
/// exclusive-mode streams bypass this API and therefore cannot be measured by this probe.
pub fn capture_process_to_summary(
  process_id: u32,
  duration: Duration,
) -> Result<ProcessLoopbackProbeResult, String> {
  capture_process_to_summary_with_format(
    process_id,
    duration,
    DEFAULT_SAMPLE_RATE,
    DEFAULT_CHANNELS,
  )
}

/// Variant of [`capture_process_to_summary`] used to probe explicit Windows channel layouts.
pub fn capture_process_to_summary_with_channels(
  process_id: u32,
  duration: Duration,
  channels: u16,
) -> Result<ProcessLoopbackProbeResult, String> {
  capture_process_to_summary_with_format(process_id, duration, DEFAULT_SAMPLE_RATE, channels)
}

/// Fully explicit process-loopback format probe.
pub fn capture_process_to_summary_with_format(
  process_id: u32,
  duration: Duration,
  sample_rate: u32,
  channels: u16,
) -> Result<ProcessLoopbackProbeResult, String> {
  if process_id == 0 {
    return Err("process id must be non-zero".to_string());
  }
  if duration.is_zero() {
    return Err("capture duration must be non-zero".to_string());
  }

  let _com = ComApartment::initialize()?;
  let audio_client = activate_process_audio_client(process_id)?;
  let format = capture_format(sample_rate, channels)?;
  unsafe {
    audio_client.Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK
        | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
        | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
        | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
      200_000,
      0,
      format.as_ptr(),
      None,
    )
  }
  .map_err(|error| format!("IAudioClient::Initialize failed: {error}"))?;

  let event = EventHandle::create()?;
  unsafe { audio_client.SetEventHandle(event.0) }
    .map_err(|error| format!("IAudioClient::SetEventHandle failed: {error}"))?;
  let capture_client: IAudioCaptureClient = unsafe { audio_client.GetService() }
    .map_err(|error| format!("IAudioClient::GetService failed: {error}"))?;

  let mut meter = SummaryMeter::new(sample_rate, channels);
  let mut silent_samples = Vec::new();
  let mut channel_peaks = vec![0.0f64; usize::from(channels)];
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

        let sample_count = frames as usize * channels as usize;
        if (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0 {
          silent_samples.resize(sample_count, 0.0);
          meter.push_interleaved(&silent_samples);
          silent_frames += u64::from(frames);
        } else {
          let samples = unsafe { std::slice::from_raw_parts(data.cast::<f32>(), sample_count) };
          for frame in samples.chunks_exact(usize::from(channels)) {
            for (peak, sample) in channel_peaks.iter_mut().zip(frame) {
              *peak = peak.max(f64::from(sample.abs()));
            }
          }
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
    sample_rate_hz: sample_rate,
    channel_count: channels,
    captured_frames,
    silent_frames,
    channel_peak_dbfs: channel_peaks.into_iter().map(db_from_linear).collect(),
    metrics: meter.finish(),
  })
}

#[cfg(test)]
mod tests {
  use super::{capture_format, ActivationPayload, CaptureFormat};
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
    let CaptureFormat::Basic(format) = capture_format(48_000, 2).expect("stereo format") else {
      panic!("stereo should use WAVEFORMATEX")
    };
    let channels = format.nChannels;
    let sample_rate = format.nSamplesPerSec;
    let bits_per_sample = format.wBitsPerSample;
    let block_align = format.nBlockAlign;
    assert_eq!(channels, 2);
    assert_eq!(sample_rate, 48_000);
    assert_eq!(bits_per_sample, 32);
    assert_eq!(block_align, 8);
  }

  #[test]
  fn multichannel_probe_uses_wave_format_extensible_with_speaker_mask() {
    let CaptureFormat::Extensible(format) = capture_format(48_000, 6).expect("5.1 format") else {
      panic!("5.1 should use WAVEFORMATEXTENSIBLE")
    };
    let channels = format.Format.nChannels;
    let tag = format.Format.wFormatTag;
    let extension_size = format.Format.cbSize;
    let channel_mask = format.dwChannelMask;
    assert_eq!(channels, 6);
    assert_eq!(tag, 0xfffe);
    assert_eq!(extension_size, 22);
    assert_eq!(channel_mask, 0x060f);
  }

  #[test]
  fn probe_format_carries_the_requested_sample_rate() {
    let CaptureFormat::Basic(format) = capture_format(96_000, 2).expect("96 kHz format") else {
      panic!("stereo should use WAVEFORMATEX")
    };
    let sample_rate = format.nSamplesPerSec;
    let bytes_per_second = format.nAvgBytesPerSec;
    assert_eq!(sample_rate, 96_000);
    assert_eq!(bytes_per_second, 96_000 * 8);
  }
}
