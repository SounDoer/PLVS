//! Windows process-loopback capture for individual applications and stereo application mixes.

use std::mem::{size_of, ManuallyDrop};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use cpal::traits::DeviceTrait;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use windows::core::{implement, IUnknown, Interface, Ref, HRESULT, PCWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_NO_MORE_FILES, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::Media::Audio::{
  ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
  IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
  IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
  AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY, AUDCLNT_BUFFERFLAGS_SILENT,
  AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR, AUDCLNT_SHAREMODE_SHARED,
  AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
  AUDCLNT_STREAMFLAGS_LOOPBACK, AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY,
  AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
  AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
  PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
  WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVEFORMATEXTENSIBLE_0,
};
use windows::Win32::System::Com::StructuredStorage::{
  PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{
  CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, BLOB, CLSCTX_ALL,
  COINIT_MULTITHREADED,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
  CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
  CreateEventW, OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE,
};
use windows::Win32::System::Variant::VT_BLOB;

use super::capture::{AudioCaptureSession, MeasuredPcmSubscriptions, MeterResetRequest, MixInput};
use super::cpal_backend::{
  emit_capture_failure, pooled_pcm_buffer_capacity, run_meter_pipeline_bridge_thread,
  PcmBufferPool, PcmCallbackForwarder, PcmDeliveryQueue, PCM_QUEUE_CAP,
};
use super::stereo_mix_timeline::{MixCoverage, MixInsert, StereoMixTimeline};
use super::windows_capture_apps::{application_id_for_process, resolve_capture_application};
use crate::dsp::channel_layouts::ChannelSelection;
use crate::dsp::speech::VadEngineKind;
use crate::dsp::summary_meter::{SummaryMeter, SummaryMetrics};
use crate::ipc::types::FrameSubscribers;
use crate::state::{AppState, MixDropStage, UiFrameDiagnosticsCounters};

const DEFAULT_SAMPLE_RATE: u32 = 48_000;
const DEFAULT_CHANNELS: u16 = 2;
const BITS_PER_SAMPLE: u16 = 32;
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;
const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: windows::core::GUID =
  windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
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
  pub timing: ProcessLoopbackTiming,
}

/// First-frame positions on the stream clock and the machine-wide QPC clock.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct PacketPosition {
  device_frame: u64,
  qpc_100ns: u64,
  captured_frame: u64,
}

/// Evidence for comparing independently opened streams without using callback arrival time.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessLoopbackTiming {
  packet_count: u64,
  discontinuity_packets: u64,
  invalid_timestamp_packets: u64,
  non_advancing_device_frames: u64,
  non_advancing_qpc: u64,
  max_qpc_frame_error_ms: f64,
  first: Option<PacketPosition>,
  last: Option<PacketPosition>,
}

impl ProcessLoopbackTiming {
  fn record(
    &mut self,
    device_frame: u64,
    qpc_100ns: u64,
    captured_frame: u64,
    sample_rate: u32,
    flags: u32,
  ) {
    self.packet_count += 1;
    if flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 != 0 {
      self.discontinuity_packets += 1;
    }
    if flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32 != 0 || qpc_100ns == 0 {
      self.invalid_timestamp_packets += 1;
      return;
    }

    if let Some(last) = self.last {
      self.non_advancing_device_frames += u64::from(device_frame <= last.device_frame);
      self.non_advancing_qpc += u64::from(qpc_100ns <= last.qpc_100ns);
    }
    let position = PacketPosition {
      device_frame,
      qpc_100ns,
      captured_frame,
    };
    let first = self.first.get_or_insert(position);
    let qpc_elapsed_ms = (i128::from(qpc_100ns) - i128::from(first.qpc_100ns)) as f64 / 10_000.0;
    let pcm_elapsed_ms =
      (captured_frame - first.captured_frame) as f64 * 1_000.0 / f64::from(sample_rate);
    self.max_qpc_frame_error_ms = self
      .max_qpc_frame_error_ms
      .max((qpc_elapsed_ms - pcm_elapsed_ms).abs());
    self.last = Some(position);
  }
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct CompletionHandler(mpsc::Sender<windows::core::Result<IUnknown>>);

impl IActivateAudioInterfaceCompletionHandler_Impl for CompletionHandler_Impl {
  fn ActivateCompleted(
    &self,
    operation: Ref<'_, IActivateAudioInterfaceAsyncOperation>,
  ) -> windows::core::Result<()> {
    let result = operation.ok().and_then(retrieve_activation_result);
    let _ = self.0.send(result);
    Ok(())
  }
}

fn retrieve_activation_result(
  operation: &IActivateAudioInterfaceAsyncOperation,
) -> windows::core::Result<IUnknown> {
  let mut activation_result = windows::core::HRESULT::default();
  let mut interface = None;
  unsafe {
    operation.GetActivateResult(&mut activation_result, &mut interface)?;
  }
  activation_result.ok()?;
  interface.ok_or_else(|| windows::core::Error::from(activation_result))
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

struct CaptureHandle(windows::Win32::Foundation::HANDLE);

impl CaptureHandle {
  fn create_event() -> Result<Self, String> {
    let handle = unsafe { CreateEventW(None, false, false, None) }
      .map_err(|error| format!("CreateEventW failed: {error}"))?;
    Ok(Self(handle))
  }
}

impl Drop for CaptureHandle {
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
  Ok(float_capture_format(sample_rate, channels, mask))
}

fn float_capture_format(sample_rate: u32, channels: u16, mask: u32) -> CaptureFormat {
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
    CaptureFormat::Basic(base)
  } else {
    CaptureFormat::Extensible(WAVEFORMATEXTENSIBLE {
      Format: base,
      Samples: WAVEFORMATEXTENSIBLE_0 {
        wValidBitsPerSample: BITS_PER_SAMPLE,
      },
      dwChannelMask: mask,
      SubFormat: KSDATAFORMAT_SUBTYPE_IEEE_FLOAT,
    })
  }
}

fn db_from_linear(value: f64) -> f64 {
  if value > 0.0 {
    20.0 * value.log10()
  } else {
    f64::NEG_INFINITY
  }
}

fn drain_capture_packets(
  capture_client: &IAudioCaptureClient,
  channels: u16,
  timestamped: bool,
  on_pcm: &mut impl FnMut(PacketTiming, &[f32]),
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
    let mut timing = PacketTiming::default();
    unsafe {
      capture_client.GetBuffer(
        &mut data,
        &mut frames,
        &mut timing.flags,
        timestamped.then_some(&mut timing.device_frame),
        timestamped.then_some(&mut timing.qpc),
      )
    }
    .map_err(|error| format!("GetBuffer failed: {error}"))?;
    if frames == 0 {
      return Ok(());
    }

    let sample_count = frames as usize * channels as usize;
    if timing.is_silent() {
      silent_samples.resize(sample_count, 0.0);
      on_pcm(timing, silent_samples);
    } else {
      let samples = unsafe { std::slice::from_raw_parts(data.cast::<f32>(), sample_count) };
      on_pcm(timing, samples);
    }
    unsafe { capture_client.ReleaseBuffer(frames) }
      .map_err(|error| format!("ReleaseBuffer failed: {error}"))?;
  }
}

#[derive(Clone, Copy, Default)]
struct PacketTiming {
  device_frame: u64,
  qpc: u64,
  flags: u32,
}

impl PacketTiming {
  fn is_silent(self) -> bool {
    self.flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0
  }

  fn has_qpc(self) -> bool {
    self.qpc != 0 && self.flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32 == 0
  }
}

fn run_process_stream(
  process_id: u32,
  sample_rate: u32,
  channels: u16,
  timestamped: bool,
  stopped: impl FnMut() -> bool,
  on_start: impl FnOnce(),
  on_pcm: impl FnMut(PacketTiming, &[f32]),
) -> Result<(), String> {
  let _com = ComApartment::initialize()?;
  let audio_client = activate_process_audio_client(process_id)?;
  let format = capture_format(sample_rate, channels)?;
  run_wasapi_stream(
    audio_client,
    &format,
    channels,
    AUDCLNT_STREAMFLAGS_LOOPBACK,
    timestamped,
    stopped,
    on_start,
    on_pcm,
  )
}

#[allow(clippy::too_many_arguments)]
fn run_wasapi_stream(
  audio_client: IAudioClient,
  format: &CaptureFormat,
  channels: u16,
  flags: u32,
  timestamped: bool,
  mut stopped: impl FnMut() -> bool,
  on_start: impl FnOnce(),
  mut on_pcm: impl FnMut(PacketTiming, &[f32]),
) -> Result<(), String> {
  unsafe {
    audio_client.Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      flags
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

  let event = CaptureHandle::create_event()?;
  unsafe { audio_client.SetEventHandle(event.0) }
    .map_err(|error| format!("IAudioClient::SetEventHandle failed: {error}"))?;
  let capture_client: IAudioCaptureClient = unsafe { audio_client.GetService() }
    .map_err(|error| format!("IAudioClient::GetService failed: {error}"))?;
  unsafe { audio_client.Start() }
    .map_err(|error| format!("IAudioClient::Start failed: {error}"))?;
  on_start();

  let mut silent_samples = Vec::new();
  let mut last_input_packet = Instant::now();
  let capture_result = loop {
    if stopped() {
      break Ok(());
    }
    if flags == 0 && last_input_packet.elapsed() >= Duration::from_secs(2) {
      break Err("input stopped delivering audio packets".into());
    }
    let wait = unsafe { WaitForSingleObject(event.0, 100) };
    if wait == WAIT_TIMEOUT {
      continue;
    }
    if wait != WAIT_OBJECT_0 {
      break Err(format!("WaitForSingleObject failed with status {}", wait.0));
    }
    if let Err(error) = drain_capture_packets(
      &capture_client,
      channels,
      timestamped,
      &mut |timing, pcm| {
        if flags == 0 {
          last_input_packet = Instant::now();
        }
        on_pcm(timing, pcm);
      },
      &mut silent_samples,
    ) {
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
  meter_resets: tauri::async_runtime::Sender<MeterResetRequest>,
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
  fn meter_resets(&self) -> &tauri::async_runtime::Sender<MeterResetRequest> {
    &self.meter_resets
  }
}

pub enum ProcessCaptureSource {
  Single(u32),
  Mix(Vec<String>, Option<MixInput>),
}

#[allow(clippy::too_many_arguments)]
pub fn start_process_session(
  source: ProcessCaptureSource,
  sample_rate: u32,
  channels: u16,
  frame_subscribers: FrameSubscribers,
  app: AppHandle,
  channel_selection: Arc<std::sync::Mutex<Option<ChannelSelection>>>,
  dialogue_gating: Arc<std::sync::Mutex<bool>>,
  dialogue_vad_engine: Arc<std::sync::Mutex<VadEngineKind>>,
  measured_pcm: Arc<MeasuredPcmSubscriptions>,
) -> Result<Box<dyn AudioCaptureSession>, String> {
  if matches!(source, ProcessCaptureSource::Single(0)) {
    return Err("process id must be non-zero".to_string());
  }
  capture_format(sample_rate, channels)?;
  let (stop_tx, stop_rx) = mpsc::channel();
  let (meter_resets, reset_requests) = tauri::async_runtime::channel(1);
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
          reset_requests,
          channel_selection,
          dialogue_gating,
          dialogue_vad_engine,
          measured_pcm,
          true,
          bridge_dropped,
          bridge_pool,
          None,
        );
        cleanup_delivery.consumer_finished(&cleanup_pool);
      });
      let forwarder = PcmCallbackForwarder::new(delivery.producer(), pool, dropped_chunks.clone());
      let result = match source {
        ProcessCaptureSource::Single(pid) => run_process_stream(
          pid,
          sample_rate,
          channels,
          false,
          || !matches!(stop_rx.try_recv(), Err(mpsc::TryRecvError::Empty)),
          || {},
          |_, pcm| {
            forwarder.forward_f32(pcm);
          },
        ),
        ProcessCaptureSource::Mix(applications, input) => {
          let diagnostics = failure_app
            .try_state::<AppState>()
            .map(|state| state.ui_frame_diagnostics.clone())
            .unwrap_or_default();
          diagnostics.begin_mix();
          run_live_mix(
            applications,
            input,
            stop_rx,
            &dropped_chunks,
            &diagnostics,
            &failure_app,
            |pcm| {
              if !forwarder.forward_f32(pcm) {
                diagnostics.record_mix_drop(MixDropStage::AnalysisQueue, 1);
              }
            },
          )
        }
      };
      delivery.stop_producer();
      let _ = bridge.join();
      if let Err(error) = &result {
        emit_capture_failure(&failure_app, error, None);
      }
      result
    })
    .map_err(|error| error.to_string())?;

  Ok(Box::new(ProcessLoopbackSession {
    stop_tx,
    join: Some(join),
    meter_resets,
  }))
}

fn run_live_mix(
  applications: Vec<String>,
  input: Option<MixInput>,
  stop_rx: mpsc::Receiver<()>,
  dropped: &AtomicU64,
  diagnostics: &UiFrameDiagnosticsCounters,
  app: &AppHandle,
  mut on_pcm: impl FnMut(&[f32]),
) -> Result<(), String> {
  let stopping = AtomicBool::new(false);
  let member_ids = applications
    .iter()
    .map(String::as_str)
    .chain(input.iter().map(|input| input.id.as_str()))
    .collect::<Vec<_>>();
  let readiness: Vec<_> = member_ids.iter().map(|_| AtomicBool::new(false)).collect();
  let on_packet_drop = |stage| {
    diagnostics.record_mix_drop(stage, 1);
    dropped.fetch_add(1, Ordering::Relaxed);
  };
  std::thread::scope(|scope| {
    let member_count = member_ids.len();
    let (tx, rx) = mpsc::sync_channel(16 * member_count);
    for (member, app_id) in applications.iter().enumerate() {
      let tx = tx.clone();
      let stopping = &stopping;
      let available = &readiness[member];
      if let Err(error) = std::thread::Builder::new()
        .name("mix-member-capture".into())
        .spawn_scoped(scope, move || {
          capture_live_member(member, app_id, &tx, stopping, available, on_packet_drop)
        })
      {
        stopping.store(true, Ordering::Relaxed);
        return Err(format!("could not start mix capture: {error}"));
      }
    }
    if let Some(input) = &input {
      let tx = tx.clone();
      let stopping = &stopping;
      let member = applications.len();
      let available = &readiness[member];
      if let Err(error) = std::thread::Builder::new()
        .name("mix-input-capture".into())
        .spawn_scoped(scope, move || {
          capture_mix_input(input, member, &tx, stopping, available, on_packet_drop)
        })
      {
        stopping.store(true, Ordering::Relaxed);
        return Err(format!("could not start mix input capture: {error}"));
      }
    }
    drop(tx);
    let mut last_report = Instant::now();
    let mut last_unavailable = None;
    let partial_at = std::cell::Cell::new(None);
    run_mix_timeline(
      rx,
      member_count,
      || {
        if matches!(stop_rx.try_recv(), Err(mpsc::TryRecvError::Empty)) {
          if last_report.elapsed() >= Duration::from_millis(250) {
            let unavailable: Vec<_> = member_ids
              .iter()
              .zip(&readiness)
              .filter(|(_, ready)| !ready.load(Ordering::Relaxed))
              .map(|(&id, _)| id)
              .collect();
            let partial_at = partial_at.take();
            if last_unavailable.as_ref() != Some(&unavailable) || partial_at.is_some() {
              let _ = app.emit(
                "mix-capture-status",
                MixCaptureStatus {
                  unavailable: &unavailable,
                  partial_at,
                },
              );
              last_unavailable = Some(unavailable);
            }
            last_report = Instant::now();
          }
          return false;
        }
        stopping.store(true, Ordering::Relaxed);
        true
      },
      |pcm, coverage| {
        if coverage.full + coverage.partial > 0 {
          if (coverage.partial > 0 || coverage.empty > 0)
            && readiness.iter().any(|ready| !ready.load(Ordering::Relaxed))
          {
            partial_at.set(
              SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .ok()
                .map(|time| time.as_millis() as u64),
            );
          }
          on_pcm(pcm);
        }
      },
      |outcome| match outcome {
        MixInsert::Overflow => on_packet_drop(MixDropStage::TimelineOverflow),
        MixInsert::Accepted { late_frames } if late_frames > 0 => {
          diagnostics.record_mix_drop(MixDropStage::LateFrames, late_frames as u64);
        }
        _ => {}
      },
    );
    stopping.store(true, Ordering::Relaxed);
    Ok(())
  })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MixCaptureStatus<'a> {
  unavailable: &'a [&'a str],
  partial_at: Option<u64>,
}

fn open_mix_input(input: &MixInput) -> Result<(IAudioClient, CaptureFormat, u16), String> {
  let (device, _) = super::device_enum::resolve_device(&input.id)?;
  let endpoint = device.id().map_err(|error| error.to_string())?;
  let id: Vec<u16> = endpoint.id().encode_utf16().chain(Some(0)).collect();
  let (client, channels, mask) = unsafe {
    let enumerator: IMMDeviceEnumerator =
      CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|error| error.to_string())?;
    let device = enumerator
      .GetDevice(PCWSTR(id.as_ptr()))
      .map_err(|error| error.to_string())?;
    let client: IAudioClient = device
      .Activate(CLSCTX_ALL, None)
      .map_err(|error| error.to_string())?;
    let format = client.GetMixFormat().map_err(|error| error.to_string())?;
    if format.is_null() {
      return Err("input returned no mix format".into());
    }
    let channels = (*format).nChannels;
    let mask = if (*format).wFormatTag == WAVE_FORMAT_EXTENSIBLE && (*format).cbSize >= 22 {
      std::ptr::addr_of!((*format.cast::<WAVEFORMATEXTENSIBLE>()).dwChannelMask).read_unaligned()
    } else {
      channel_mask(channels).unwrap_or(0)
    };
    CoTaskMemFree(Some(format.cast()));
    (client, channels, mask)
  };
  if channels == 0
    || channels > 256
    || !input.has_valid_channels()
    || input.channels.iter().any(|&channel| channel >= channels)
  {
    return Err("selected input channels are unavailable".into());
  }
  Ok((
    client,
    float_capture_format(DEFAULT_SAMPLE_RATE, channels, mask),
    channels,
  ))
}

fn capture_mix_input(
  input: &MixInput,
  member: usize,
  tx: &mpsc::SyncSender<MixPacket>,
  stopping: &AtomicBool,
  available: &AtomicBool,
  on_drop: impl Fn(MixDropStage) + Copy,
) {
  let stopped = || stopping.load(Ordering::Relaxed);
  let mut last_error = None;
  while !stopped() {
    let result = run_mix_input_stream(
      input,
      member,
      &mut |packet| tx.try_send(packet).is_ok(),
      on_drop,
      stopped,
      || available.store(true, Ordering::Relaxed),
    );
    available.store(false, Ordering::Relaxed);
    if let Err(error) = result {
      if last_error.as_ref() != Some(&error) {
        log::warn!("Mix input capture interrupted: {error}");
        last_error = Some(error);
      }
    }
    wait_for_mix_retry(stopping);
  }
}

fn run_mix_input_stream(
  input: &MixInput,
  member: usize,
  send: &mut impl FnMut(MixPacket) -> bool,
  mut on_drop: impl FnMut(MixDropStage),
  stopped: impl FnMut() -> bool,
  on_start: impl FnOnce(),
) -> Result<(), String> {
  let _com = ComApartment::initialize()?;
  let (client, format, channels) = open_mix_input(input)?;
  let mut pending: Option<MixPacket> = None;
  run_wasapi_stream(
    client,
    &format,
    channels,
    0,
    true,
    stopped,
    on_start,
    |timing, pcm| {
      let next = timing.has_qpc().then(|| MixPacket {
        member,
        qpc: timing.qpc,
        end_qpc: None,
        frames: pcm
          .chunks_exact(usize::from(channels))
          .map(|frame| mix_input_stereo_frame(frame, &input.channels))
          .collect(),
      });
      if let Some(mut previous) = std::mem::replace(&mut pending, next) {
        if timing.has_qpc() && timing.flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 == 0 {
          previous.end_qpc = Some(timing.qpc);
        }
        if !send(previous) {
          on_drop(MixDropStage::IngressQueue);
        }
      }
      if !timing.has_qpc() {
        on_drop(MixDropStage::InvalidTimestamp);
      }
    },
  )
}

fn mix_input_stereo_frame(frame: &[f32], channels: &[u16]) -> [f32; 2] {
  let sum = channels
    .iter()
    .map(|&index| frame[usize::from(index)])
    .sum::<f32>();
  [sum * std::f32::consts::FRAC_1_SQRT_2; 2]
}

fn capture_live_member(
  member: usize,
  app_id: &str,
  tx: &mpsc::SyncSender<MixPacket>,
  stopping: &AtomicBool,
  available: &AtomicBool,
  on_drop: impl Fn(MixDropStage),
) {
  let stopped = || stopping.load(Ordering::Relaxed);
  while !stopped() {
    if let Ok(app) = resolve_capture_application(app_id) {
      if let Ok(handle) = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, app.process_id) } {
        let handle = CaptureHandle(handle);
        if application_id_for_process(app.process_id).as_deref() == Some(app_id) {
          let exited = || unsafe { WaitForSingleObject(handle.0, 0) } == WAIT_OBJECT_0;
          let result = run_process_stream(
            app.process_id,
            DEFAULT_SAMPLE_RATE,
            DEFAULT_CHANNELS,
            true,
            || stopped() || exited(),
            || available.store(true, Ordering::Relaxed),
            |timing, pcm| {
              if !stopped() && !exited() {
                if let Err(stage) = queue_mix_packet(tx, member, timing, pcm) {
                  on_drop(stage);
                }
              }
            },
          );
          available.store(false, Ordering::Relaxed);
          if let Err(error) = result {
            log::debug!("Mix member capture interrupted: {error}");
          }
        }
      }
    }
    // Retry a missing or failed member without resetting the mix worker or its meter.
    wait_for_mix_retry(stopping);
  }
}

fn wait_for_mix_retry(stopping: &AtomicBool) {
  for _ in 0..5 {
    if stopping.load(Ordering::Relaxed) {
      return;
    }
    std::thread::sleep(Duration::from_millis(100));
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
  capture_process_probe(process_id, duration, sample_rate, channels, None, |_, _| {})
}

/// Probe two 48 kHz stereo streams through the bounded mix worker.
pub fn capture_stereo_mix_probe(
  process_ids: [u32; 2],
  seconds: u64,
  restart_parent_pid: Option<u32>,
) -> Result<StereoMixProbeResult, String> {
  if !(1..=60).contains(&seconds) {
    return Err("mix probe duration must be between 1 and 60 seconds".to_string());
  }
  let capture = |member, pid, duration, tx: &mpsc::SyncSender<MixPacket>| {
    let process = CaptureHandle(
      unsafe { OpenProcess(PROCESS_SYNCHRONIZE, false, pid) }
        .map_err(|error| format!("could not monitor process {pid}: {error}"))?,
    );
    let mut dropped = 0;
    let report = capture_process_probe(
      pid,
      duration,
      DEFAULT_SAMPLE_RATE,
      DEFAULT_CHANNELS,
      Some(&process),
      |timing, packet| {
        // WASAPI can still send silence for an exited PID. Keep that distinct from an idle app.
        if unsafe { WaitForSingleObject(process.0, 0) } == WAIT_OBJECT_0 {
          return;
        }
        if queue_mix_packet(tx, member, timing, packet).is_err() {
          dropped += 1;
        }
      },
    )?;
    Ok::<_, String>((report, dropped))
  };

  std::thread::scope(|scope| {
    let (tx, rx) = mpsc::sync_channel(32);
    let left_tx = tx.clone();
    let duration = Duration::from_secs(seconds);
    let deadline = Instant::now() + duration;
    let first = scope.spawn(move || capture(0, process_ids[0], duration, &left_tx));
    let second = scope.spawn(move || {
      let restart = match restart_parent_pid {
        Some(parent_pid) => Some((
          parent_pid,
          application_id_for_process(process_ids[1])
            .ok_or("could not identify the original app")?,
        )),
        None => None,
      };
      let (right, mut dropped) = capture(1, process_ids[1], duration, &tx)?;
      let mut replacement = None;
      if let Some((parent_pid, app_id)) = restart {
        let pid = wait_for_rig_replacement(parent_pid, &app_id, process_ids, deadline)?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        let (report, replacement_dropped) = capture(1, pid, remaining, &tx)?;
        replacement = Some(report);
        dropped += replacement_dropped;
      }
      Ok::<_, String>((right, replacement, dropped))
    });
    let mut mixed = measure_streaming_stereo(rx);
    let (left, left_dropped) = first
      .join()
      .map_err(|_| "first capture thread panicked")??;
    let (right, replacement, right_dropped) = second
      .join()
      .map_err(|_| "second capture thread panicked")??;
    if let Ok(mixed) = &mut mixed {
      mixed.dropped_packets += left_dropped + right_dropped;
    }
    Ok(StereoMixProbeResult {
      streams: [left, right],
      replacement,
      measurement: mixed,
    })
  })
}

/// Exercise the desktop input reader and app loopback together on the leased Windows rig.
pub fn capture_input_mix_probe(
  process_id: u32,
  input_label: &str,
  seconds: u64,
) -> Result<(ProcessLoopbackProbeResult, MixProbeMeasurement), String> {
  if !(1..=60).contains(&seconds) {
    return Err("mix probe duration must be between 1 and 60 seconds".into());
  }
  let input = MixInput {
    id: super::device_enum::resolve_device_id_by_substring(input_label)?,
    channels: vec![1],
  };
  let dropped = AtomicU64::new(0);
  let duration = Duration::from_secs(seconds);
  let deadline = Instant::now() + duration;
  std::thread::scope(|scope| {
    let (tx, rx) = mpsc::sync_channel(32);
    let app_tx = tx.clone();
    let dropped = &dropped;
    let app = scope.spawn(move || {
      capture_process_probe(
        process_id,
        duration,
        DEFAULT_SAMPLE_RATE,
        DEFAULT_CHANNELS,
        None,
        |timing, pcm| {
          if queue_mix_packet(&app_tx, 0, timing, pcm).is_err() {
            dropped.fetch_add(1, Ordering::Relaxed);
          }
        },
      )
    });
    let device = scope.spawn(move || {
      run_mix_input_stream(
        &input,
        1,
        &mut |packet| tx.try_send(packet).is_ok(),
        |_| {
          dropped.fetch_add(1, Ordering::Relaxed);
        },
        || Instant::now() >= deadline,
        || {},
      )
    });
    let measured = measure_streaming_stereo(rx);
    let application = app
      .join()
      .map_err(|_| "application probe thread panicked")??;
    device.join().map_err(|_| "input probe thread panicked")??;
    let mut measurement = measured?;
    measurement.dropped_packets += dropped.load(Ordering::Relaxed) as usize;
    Ok((application, measurement))
  })
}

// The rig uses windowless players. Restrict discovery to its launcher so an unrelated
// desktop application with the same executable cannot be picked up by the probe.
fn wait_for_rig_replacement(
  parent_pid: u32,
  app_id: &str,
  previous: [u32; 2],
  deadline: Instant,
) -> Result<u32, String> {
  while Instant::now() < deadline {
    if let Some(pid) = find_rig_replacement(parent_pid, app_id, previous)? {
      return Ok(pid);
    }
    std::thread::sleep(Duration::from_millis(100));
  }
  Err("the original application did not restart before the probe ended".into())
}

fn find_rig_replacement(
  parent_pid: u32,
  app_id: &str,
  previous: [u32; 2],
) -> Result<Option<u32>, String> {
  let snapshot = CaptureHandle(
    unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
      .map_err(|error| format!("could not list rig processes: {error}"))?,
  );
  let mut entry = PROCESSENTRY32W {
    dwSize: size_of::<PROCESSENTRY32W>() as u32,
    ..Default::default()
  };
  unsafe { Process32FirstW(snapshot.0, &mut entry) }
    .map_err(|error| format!("could not read rig processes: {error}"))?;
  let mut candidate = None;
  loop {
    let pid = entry.th32ProcessID;
    if entry.th32ParentProcessID == parent_pid
      && !previous.contains(&pid)
      && application_id_for_process(pid).as_deref() == Some(app_id)
      && candidate.replace(pid).is_some()
    {
      return Ok(None);
    }
    match unsafe { Process32NextW(snapshot.0, &mut entry) } {
      Ok(()) => {}
      Err(error) if error.code() == HRESULT::from_win32(ERROR_NO_MORE_FILES.0) => break,
      Err(error) => return Err(format!("could not read rig processes: {error}")),
    }
  }
  Ok(candidate)
}

pub struct StereoMixProbeResult {
  pub streams: [ProcessLoopbackProbeResult; 2],
  pub replacement: Option<ProcessLoopbackProbeResult>,
  pub measurement: Result<MixProbeMeasurement, String>,
}

struct MixPacket {
  member: usize,
  qpc: u64,
  end_qpc: Option<u64>,
  frames: Vec<[f32; 2]>,
}

fn queue_mix_packet(
  tx: &mpsc::SyncSender<MixPacket>,
  member: usize,
  timing: PacketTiming,
  pcm: &[f32],
) -> Result<(), MixDropStage> {
  if !timing.has_qpc() {
    return Err(MixDropStage::InvalidTimestamp);
  }
  tx.try_send(MixPacket {
    member,
    qpc: timing.qpc,
    end_qpc: None,
    frames: Vec::from(pcm.as_chunks::<2>().0),
  })
  .map_err(|_| MixDropStage::IngressQueue)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MixProbeMeasurement {
  compared_frames: usize,
  partial_frames: usize,
  empty_frames: usize,
  dropped_packets: usize,
  integrated_lufs: f64,
  true_peak_max_dbtp: f64,
  sample_peak_max_l_db: f64,
  sample_peak_max_r_db: f64,
  min_full_window_peak_l_db: Option<f64>,
}

fn measure_streaming_stereo(rx: mpsc::Receiver<MixPacket>) -> Result<MixProbeMeasurement, String> {
  let mut meter = SummaryMeter::new(DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS);
  let mut coverage = MixCoverage::default();
  let mut dropped = 0;
  let mut window_frames = 0;
  let mut window_peak = 0.0_f32;
  let mut min_window_peak = None::<f32>;
  let started = run_mix_timeline(
    rx,
    2,
    || false,
    |pcm, rendered| {
      coverage.full += rendered.full;
      coverage.partial += rendered.partial;
      coverage.empty += rendered.empty;
      if rendered.full + rendered.partial > 0 {
        meter.push_interleaved(pcm);
      }
      // Compare the beat envelope in contiguous 10 ms windows after capture has settled.
      if coverage.full < DEFAULT_SAMPLE_RATE as usize || rendered.full != pcm.len() / 2 {
        window_frames = 0;
        window_peak = 0.0;
        return;
      }
      for frame in pcm.as_chunks::<2>().0 {
        window_peak = window_peak.max(frame[0].abs());
        window_frames += 1;
        if window_frames == DEFAULT_SAMPLE_RATE / 100 {
          // The two frequencies cannot cancel to digital silence for an entire window.
          if window_peak > 0.0 {
            min_window_peak =
              Some(min_window_peak.map_or(window_peak, |peak| peak.min(window_peak)));
          }
          window_frames = 0;
          window_peak = 0.0;
        }
      }
    },
    |outcome| {
      if outcome == MixInsert::Overflow {
        dropped += 1;
      }
    },
  );
  if !started {
    return Err("mix received no valid PCM packets".into());
  }
  let metrics = meter.finish();
  Ok(MixProbeMeasurement {
    compared_frames: coverage.full,
    partial_frames: coverage.partial,
    empty_frames: coverage.empty,
    dropped_packets: dropped,
    integrated_lufs: metrics.integrated_lufs,
    true_peak_max_dbtp: metrics.true_peak_max_dbtp,
    sample_peak_max_l_db: metrics.sample_peak_max_l_db,
    sample_peak_max_r_db: metrics.sample_peak_max_r_db,
    min_full_window_peak_l_db: min_window_peak.map(|peak| 20.0 * f64::from(peak).log10()),
  })
}

fn run_mix_timeline(
  rx: mpsc::Receiver<MixPacket>,
  member_count: usize,
  stopped: impl FnMut() -> bool,
  on_block: impl FnMut(&[f32], MixCoverage),
  on_insert: impl FnMut(MixInsert),
) -> bool {
  run_mix_timeline_with_clock(rx, member_count, stopped, on_block, on_insert, Instant::now)
}

fn run_mix_timeline_with_clock(
  rx: mpsc::Receiver<MixPacket>,
  member_count: usize,
  mut stopped: impl FnMut() -> bool,
  mut on_block: impl FnMut(&[f32], MixCoverage),
  mut on_insert: impl FnMut(MixInsert),
  mut now: impl FnMut() -> Instant,
) -> bool {
  const DELAY: Duration = Duration::from_millis(80);
  const POLL: Duration = Duration::from_millis(5);
  const RATE: usize = DEFAULT_SAMPLE_RATE as usize;
  // The larger ring absorbs bursts without permitting unbounded accumulation.
  let mut timeline = StereoMixTimeline::new(member_count, RATE / 2);
  let mut block = [[0.0; 2]; RATE / 100];
  let mut adjusted = Vec::new();
  let first = loop {
    if stopped() {
      return false;
    }
    match rx.recv_timeout(POLL) {
      Ok(packet) => break packet,
      Err(mpsc::RecvTimeoutError::Disconnected) => return false,
      Err(mpsc::RecvTimeoutError::Timeout) => {}
    }
  };
  let epoch = first.qpc;
  let frame_at = |qpc| {
    let ticks = i128::from(qpc) - i128::from(epoch);
    let scaled = ticks * RATE as i128;
    ((scaled + scaled.signum() * 5_000_000) / 10_000_000) as i64
  };
  let started = now();
  let mut observed_end = 0;
  let mut pending = Ok(first);

  loop {
    if let Ok(packet) = &pending {
      let position = frame_at(packet.qpc);
      let frames = packet
        .end_qpc
        .and_then(|end| usize::try_from(frame_at(end) - position).ok())
        .and_then(|len| adjust_input_clock(&packet.frames, len, &mut adjusted))
        .unwrap_or(&packet.frames);
      let outcome = timeline.push(packet.member, position, frames);
      if outcome != MixInsert::Overflow {
        observed_end = observed_end.max(position + frames.len() as i64);
      }
      on_insert(outcome);
    }
    let finished = matches!(pending, Err(mpsc::RecvTimeoutError::Disconnected)) || stopped();
    let release_at = if finished {
      observed_end
    } else {
      let elapsed = now()
        .saturating_duration_since(started)
        .saturating_sub(DELAY);
      let due = (elapsed.as_nanos() * RATE as u128 / 1_000_000_000) as i64;
      // Independent packet cadences can wake the mixer several times within one meter block.
      // Keep the delivery rate independent of those wakes and release the short tail on stop.
      let block_frames = block.len() as i64;
      due - due % block_frames
    };
    while timeline.cursor() < release_at {
      let count = ((release_at - timeline.cursor()) as usize).min(block.len());
      let block = &mut block[..count];
      let rendered = timeline.render(block);
      on_block(block.as_flattened(), rendered);
    }
    if finished {
      break;
    }
    pending = rx.recv_timeout(POLL);
  }
  true
}

// WASAPI handles nominal sample-rate conversion. Move the input packet boundary to match
// its measured clock, within a small allowance. A larger timestamp jump is a real gap.
fn adjust_input_clock<'a>(
  frames: &[[f32; 2]],
  length: usize,
  output: &'a mut Vec<[f32; 2]>,
) -> Option<&'a [[f32; 2]]> {
  if length < 2
    || frames.len() < 2
    || length == frames.len()
    || length.abs_diff(frames.len()) > 2 + frames.len() / 200
  {
    return None;
  }
  output.clear();
  let step = (frames.len() - 1) as f64 / (length - 1) as f64;
  output.extend((0..length).map(|index| {
    let at = index as f64 * step;
    let lower = at as usize;
    let upper = (lower + 1).min(frames.len() - 1);
    let fraction = (at - lower as f64) as f32;
    std::array::from_fn(|channel| {
      let value = frames[lower][channel];
      value + fraction * (frames[upper][channel] - value)
    })
  }));
  Some(output)
}

fn capture_process_probe(
  process_id: u32,
  duration: Duration,
  sample_rate: u32,
  channels: u16,
  process: Option<&CaptureHandle>,
  mut on_pcm: impl FnMut(PacketTiming, &[f32]),
) -> Result<ProcessLoopbackProbeResult, String> {
  if process_id == 0 {
    return Err("process id must be non-zero".to_string());
  }
  if duration.is_zero() {
    return Err("capture duration must be non-zero".to_string());
  }

  let mut meter = SummaryMeter::new(sample_rate, channels);
  let mut channel_peaks = vec![0.0f64; usize::from(channels)];
  let mut captured_frames = 0u64;
  let mut silent_frames = 0u64;
  let mut timing = ProcessLoopbackTiming::default();
  let mut started = None;
  run_process_stream(
    process_id,
    sample_rate,
    channels,
    true,
    || {
      started.get_or_insert_with(Instant::now).elapsed() >= duration
        || process
          .is_some_and(|handle| unsafe { WaitForSingleObject(handle.0, 0) } == WAIT_OBJECT_0)
    },
    || {},
    |packet, samples| {
      let frames = (samples.len() / usize::from(channels)) as u64;
      timing.record(
        packet.device_frame,
        packet.qpc,
        captured_frames,
        sample_rate,
        packet.flags,
      );
      if packet.is_silent() {
        silent_frames += frames;
      } else {
        for frame in samples.chunks_exact(usize::from(channels)) {
          for (peak, sample) in channel_peaks.iter_mut().zip(frame) {
            *peak = peak.max(f64::from(sample.abs()));
          }
        }
      }
      meter.push_interleaved(samples);
      on_pcm(packet, samples);
      captured_frames += frames;
    },
  )?;

  Ok(ProcessLoopbackProbeResult {
    process_id,
    sample_rate_hz: sample_rate,
    channel_count: channels,
    captured_frames,
    silent_frames,
    channel_peak_dbfs: channel_peaks.into_iter().map(db_from_linear).collect(),
    metrics: meter.finish(),
    timing,
  })
}

#[cfg(test)]
mod tests {
  use super::{
    capture_format, measure_streaming_stereo, run_mix_timeline, ActivationPayload, CaptureFormat,
    MixPacket, ProcessLoopbackTiming,
  };
  use windows::Win32::Media::Audio::{
    AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY, AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
  };
  use windows::Win32::System::Variant::VT_BLOB;

  #[test]
  fn mix_can_stop_before_any_member_delivers_pcm() {
    let (_sender, receiver) = std::sync::mpsc::sync_channel(2);
    assert!(!run_mix_timeline(
      receiver,
      2,
      || true,
      |_, _| panic!("unexpected PCM"),
      |_| panic!("unexpected drop")
    ));
  }

  #[test]
  fn mix_distinguishes_bad_timestamps_from_a_saturated_ingress_queue() {
    use super::{queue_mix_packet, MixDropStage, PacketTiming};
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let mut timing = PacketTiming {
      qpc: 10_000,
      ..PacketTiming::default()
    };
    assert!(queue_mix_packet(&tx, 0, timing, &[0.25, 0.0]).is_ok());
    assert_eq!(
      queue_mix_packet(&tx, 0, timing, &[0.25, 0.0]),
      Err(MixDropStage::IngressQueue)
    );
    timing.flags = AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32;
    assert_eq!(
      queue_mix_packet(&tx, 0, timing, &[0.25, 0.0]),
      Err(MixDropStage::InvalidTimestamp)
    );
    assert_eq!(rx.try_iter().count(), 1);
  }

  #[test]
  fn interleaved_packets_keep_fixed_blocks_through_clock_drift_and_input_restart() {
    use super::{run_mix_timeline_with_clock, Duration, Instant, MixInsert};
    const BLOCK: usize = 480;
    const PACKETS: usize = 800;
    let position = |index| index * BLOCK + index / 10;
    let qpc = |frame: usize| 1_000_000 + ((frame as u64 * 10_000_000 + 24_000) / 48_000);
    let time = |frame: usize| Duration::from_nanos(frame as u64 * 1_000_000_000 / 48_000);
    let mut arrivals = Vec::new();
    for index in 0..=PACKETS {
      let frames = if index == PACKETS { BLOCK / 2 } else { BLOCK };
      let at = index * BLOCK;
      arrivals.push((
        time(at + index % 5 * 29),
        MixPacket {
          member: 0,
          qpc: qpc(at),
          end_qpc: None,
          frames: vec![[0.25, 0.0]; frames],
        },
      ));
      if index < PACKETS && !(200..280).contains(&index) {
        let at = position(index);
        arrivals.push((
          time(at + 96 + index % 7 * 31),
          MixPacket {
            member: 1,
            qpc: qpc(at),
            end_qpc: Some(qpc(position(index + 1))),
            frames: vec![[0.125, 0.5]; BLOCK],
          },
        ));
      }
    }
    arrivals.sort_by_key(|(time, _)| *time);
    let (tx, rx) = std::sync::mpsc::sync_channel(arrivals.len());
    let mut ticks = vec![Duration::ZERO];
    for (arrival, packet) in arrivals {
      ticks.push(arrival);
      tx.send(packet).unwrap();
    }
    drop(tx);
    let now = Instant::now();
    let mut ticks = ticks.into_iter();
    let mut rendered = 0;
    let mut block_sizes = Vec::new();
    assert!(run_mix_timeline_with_clock(
      rx,
      2,
      || false,
      |pcm, coverage| {
        let mut full = 0;
        let frames = pcm.as_chunks::<2>().0;
        block_sizes.push(frames.len());
        for (index, frame) in frames.iter().enumerate() {
          let at = rendered + index;
          let input = !(position(200)..position(280)).contains(&at) && at < position(PACKETS);
          assert_eq!(
            *frame,
            if input { [0.375, 0.5] } else { [0.25, 0.0] },
            "frame {at}"
          );
          full += usize::from(input);
        }
        assert_eq!(coverage.full, full);
        assert_eq!(coverage.partial, frames.len() - full);
        assert_eq!(coverage.empty, 0);
        rendered += frames.len();
      },
      |outcome| assert_eq!(outcome, MixInsert::Accepted { late_frames: 0 }),
      || now + ticks.next().unwrap(),
    ));
    let (&tail, full) = block_sizes.split_last().unwrap();
    assert!(full.iter().all(|&size| size == BLOCK));
    assert_eq!(tail, BLOCK / 2);
    assert_eq!(rendered, PACKETS * BLOCK + BLOCK / 2);
  }

  #[test]
  fn mix_probe_aligns_offset_packets_and_preserves_over_range_peaks() {
    let (tx, rx) = std::sync::mpsc::sync_channel(2);
    tx.send(MixPacket {
      member: 0,
      qpc: 100_000,
      end_qpc: None,
      frames: vec![[0.0, 0.0], [0.75, 0.25]],
    })
    .unwrap();
    tx.send(MixPacket {
      member: 1,
      qpc: 100_208,
      end_qpc: None,
      frames: vec![[0.75, -0.25], [0.0, 0.0]],
    })
    .unwrap();
    drop(tx);

    let mix = measure_streaming_stereo(rx).unwrap();

    assert_eq!(mix.compared_frames, 1);
    assert_eq!(mix.partial_frames, 2);
    assert!((mix.sample_peak_max_l_db - 20.0 * 1.5_f64.log10()).abs() < 0.000_001);
    assert!(!mix.sample_peak_max_r_db.is_finite());
  }

  #[test]
  fn mix_input_maps_selected_channels_without_folding_in_other_channels() {
    let frame = [0.25, 1.0, -0.5];
    assert_eq!(
      super::mix_input_stereo_frame(&frame, &[1]),
      [std::f32::consts::FRAC_1_SQRT_2; 2]
    );
    assert_eq!(
      super::mix_input_stereo_frame(&frame, &[0, 2]),
      [-0.25 * std::f32::consts::FRAC_1_SQRT_2; 2]
    );
  }

  #[test]
  fn small_input_clock_correction_stretches_pcm_but_large_gaps_stay_gaps() {
    let frames = [[0.0, 1.0], [1.0, 0.0]];
    let mut adjusted = Vec::new();
    assert_eq!(
      super::adjust_input_clock(&frames, 3, &mut adjusted).unwrap(),
      [[0.0, 1.0], [0.5, 0.5], [1.0, 0.0]]
    );
    assert!(super::adjust_input_clock(&frames, 10, &mut adjusted).is_none());
  }

  #[test]
  fn probe_distinguishes_timestamp_errors_from_discontinuities() {
    let mut timing = ProcessLoopbackTiming::default();
    timing.record(0, 0, 0, 48_000, 0);
    timing.record(
      0,
      100_000,
      480,
      48_000,
      AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32,
    );
    timing.record(
      0,
      900_000,
      960,
      48_000,
      AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR.0 as u32,
    );
    timing.record(0, 300_000, 1_440, 48_000, 0);
    timing.record(0, 300_000, 1_920, 48_000, 0);

    assert_eq!(timing.packet_count, 5);
    assert_eq!(timing.discontinuity_packets, 1);
    assert_eq!(timing.invalid_timestamp_packets, 2);
    assert_eq!(timing.non_advancing_device_frames, 2);
    assert_eq!(timing.non_advancing_qpc, 1);
    assert_eq!(timing.first.unwrap().captured_frame, 480);
    assert_eq!(timing.last.unwrap().captured_frame, 1_920);
    assert_eq!(timing.max_qpc_frame_error_ms, 10.0);
  }

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
