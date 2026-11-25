//! Live Mix worker shared by timestamped platform capture backends.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(target_os = "macos")]
use rubato::audioadapter_buffers::direct::InterleavedSlice;
#[cfg(target_os = "macos")]
use rubato::{
  Async, FixedAsync, Resampler, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::capture::{
  AudioCaptureSession, MeasuredPcmSubscriptions, MeterResetRequest, MixInput, MixLaneRoutes,
  MixRouting,
};
use super::cpal_backend::{
  emit_capture_failure, pooled_pcm_buffer_capacity, run_meter_pipeline_bridge_thread,
  CaptureProgress, PcmBufferPool, PcmCallbackForwarder, PcmDeliveryQueue, PCM_QUEUE_CAP,
};
use super::source_layout::NativeLayout;
use super::stereo_mix_timeline::{run_mix_timeline, MixInsert, MixPacket, MIX_SAMPLE_RATE};
use crate::dsp::speech::VadEngineKind;
use crate::ipc::types::FrameSubscribers;
use crate::state::{AppState, MixDropStage, UiFrameDiagnosticsCounters};

const MAX_CHANNELS: usize = 16;

pub(super) enum Source<'a> {
  Application(&'a str),
  Input(&'a MixInput),
  Output(&'a str, &'a [String]),
}

impl Source<'_> {
  fn id(&self) -> &str {
    match self {
      Self::Application(id) | Self::Output(id, _) => id,
      Self::Input(input) => &input.id,
    }
  }
}

pub(super) struct Member<'a> {
  pub source: Source<'a>,
  pub routes: &'a MixLaneRoutes,
  stop: &'a AtomicBool,
  ready: &'a AtomicBool,
  tx: mpsc::SyncSender<MixPacket<MAX_CHANNELS>>,
  index: usize,
  diagnostics: &'a UiFrameDiagnosticsCounters,
  dropped: &'a AtomicU64,
}

impl Member<'_> {
  pub fn stopped(&self) -> bool {
    self.stop.load(Ordering::Relaxed)
  }

  pub fn set_ready(&self, ready: bool) {
    self.ready.store(ready, Ordering::Relaxed);
  }

  pub fn record_drop(&self, stage: MixDropStage) {
    self.record_drops(stage, 1);
  }

  pub fn record_drops(&self, stage: MixDropStage, count: u64) {
    if count > 0 {
      self.diagnostics.record_mix_drop(stage, count);
      self.dropped.fetch_add(count, Ordering::Relaxed);
    }
  }

  pub fn send(
    &self,
    stream: Option<u32>,
    time_100ns: u64,
    end_time_100ns: Option<u64>,
    frames: Vec<[f32; MAX_CHANNELS]>,
  ) {
    if !frames.is_empty()
      && self
        .tx
        .try_send(MixPacket {
          member: self.index,
          stream,
          time_100ns,
          end_time_100ns,
          frames,
        })
        .is_err()
    {
      self.record_drop(MixDropStage::IngressQueue);
    }
  }

  pub fn project(&self, samples: impl IntoIterator<Item = f32>) -> [f32; MAX_CHANNELS] {
    let mut frame = [0.0; MAX_CHANNELS];
    for (sample, lane) in samples.into_iter().zip(self.routes) {
      for &(target, gain) in lane {
        frame[target] += sample * gain;
      }
    }
    frame
  }
}

/// Converts the native capture rate to the Mix rate using a continuous band-limited filter.
#[cfg(target_os = "macos")]
pub(super) struct MemberPcm<'a, 'member> {
  member: &'a Member<'member>,
  native_rate: u32,
  resampler: Option<Async<f32>>,
  chunk_frames: usize,
  input: Vec<[f32; MAX_CHANNELS]>,
  output: Vec<[f32; MAX_CHANNELS]>,
  next_chunk_time: u64,
  next_input_time: u64,
  pending: Option<(u64, Vec<[f32; MAX_CHANNELS]>)>,
}

#[cfg(target_os = "macos")]
impl<'a, 'member> MemberPcm<'a, 'member> {
  pub fn new(member: &'a Member<'member>, native_rate: u32) -> Result<Self, String> {
    if native_rate == 0 {
      return Err("Mix source sample rate is unavailable.".into());
    }
    let chunk_frames = (native_rate as usize / 100).max(1);
    let resampler = if native_rate != MIX_SAMPLE_RATE {
      let params = SincInterpolationParameters {
        sinc_len: 128,
        f_cutoff: Some(0.95),
        oversampling_factor: 128,
        interpolation: SincInterpolationType::Linear,
        window: WindowFunction::BlackmanHarris2,
      };
      Some(
        Async::<f32>::new_sinc(
          f64::from(MIX_SAMPLE_RATE) / f64::from(native_rate),
          1.005,
          &params,
          chunk_frames,
          MAX_CHANNELS,
          FixedAsync::Input,
        )
        .map_err(|error| format!("Cannot resample Mix source: {error}"))?,
      )
    } else {
      None
    };
    let output_frames = resampler.as_ref().map_or(0, Resampler::output_frames_max);
    Ok(Self {
      member,
      native_rate,
      resampler,
      chunk_frames,
      input: Vec::new(),
      output: vec![[0.0; MAX_CHANNELS]; output_frames],
      next_chunk_time: 0,
      next_input_time: 0,
      pending: None,
    })
  }

  pub fn push(
    &mut self,
    timestamp: u64,
    frames: impl ExactSizeIterator<Item = [f32; MAX_CHANNELS]>,
  ) -> Result<(), String> {
    if timestamp == 0 {
      self.member.record_drop(MixDropStage::InvalidTimestamp);
      return Ok(());
    }
    let Some(resampler) = &mut self.resampler else {
      Self::queue(self.member, &mut self.pending, timestamp, frames.collect());
      return Ok(());
    };
    let ticks = |frames: usize| frames as u64 * 10_000_000 / u64::from(self.native_rate);
    // Flush across a real timestamp gap. Jitter within a continuous chunk moves the timestamp
    // of the next chunk with the device clock, without throwing away filter history.
    if self.next_input_time.abs_diff(timestamp) > 20_000 {
      self.input.clear();
      resampler.reset();
    }
    self.next_chunk_time = timestamp.saturating_sub(ticks(self.input.len()));
    self.next_input_time = timestamp + ticks(frames.len());
    self.input.extend(frames);
    while self.input.len() >= self.chunk_frames {
      let input = InterleavedSlice::new(
        self.input[..self.chunk_frames].as_flattened(),
        MAX_CHANNELS,
        self.chunk_frames,
      )
      .map_err(|error| error.to_string())?;
      let capacity = self.output.len();
      let mut output =
        InterleavedSlice::new_mut(self.output.as_flattened_mut(), MAX_CHANNELS, capacity)
          .map_err(|error| error.to_string())?;
      let (_, frames) = resampler
        .process_into_buffer(&input, &mut output, None)
        .map_err(|error| format!("Mix resampling failed: {error}"))?;
      let delay = resampler.output_delay() as u64 * 10_000_000 / u64::from(MIX_SAMPLE_RATE);
      Self::queue(
        self.member,
        &mut self.pending,
        self.next_chunk_time.saturating_sub(delay),
        self.output[..frames].to_vec(),
      );
      self.next_chunk_time += ticks(self.chunk_frames);
      self.input.drain(..self.chunk_frames);
    }
    Ok(())
  }

  fn queue(
    member: &Member<'_>,
    pending: &mut Option<(u64, Vec<[f32; MAX_CHANNELS]>)>,
    timestamp: u64,
    frames: Vec<[f32; MAX_CHANNELS]>,
  ) {
    if let Some((previous, pcm)) = pending.replace((timestamp, frames)) {
      member.send(None, previous, Some(timestamp), pcm);
    }
  }
}

#[cfg(target_os = "macos")]
impl Drop for MemberPcm<'_, '_> {
  fn drop(&mut self) {
    if let Some((timestamp, frames)) = self.pending.take() {
      self.member.send(None, timestamp, None, frames);
    }
  }
}

struct LiveMixSession {
  stop: Arc<AtomicBool>,
  worker: Option<std::thread::JoinHandle<()>>,
  meter_resets: tauri::async_runtime::Sender<MeterResetRequest>,
}

impl Drop for LiveMixSession {
  fn drop(&mut self) {
    self.stop.store(true, Ordering::Relaxed);
    if let Some(worker) = self.worker.take() {
      let _ = worker.join();
    }
  }
}

impl AudioCaptureSession for LiveMixSession {
  fn meter_resets(&self) -> &tauri::async_runtime::Sender<MeterResetRequest> {
    &self.meter_resets
  }
}

pub(crate) struct MixSources {
  pub applications: Vec<String>,
  pub inputs: Vec<MixInput>,
  pub output: Option<String>,
  pub routing: MixRouting,
}

pub(super) fn start(
  sources: MixSources,
  capture: impl for<'a> Fn(Member<'a>) + Sync + Send + 'static,
  frame_subscribers: FrameSubscribers,
  app: AppHandle,
  dialogue_gating: Arc<Mutex<bool>>,
  dialogue_vad_engine: Arc<Mutex<VadEngineKind>>,
  measured_pcm: Arc<MeasuredPcmSubscriptions>,
) -> Result<Box<dyn AudioCaptureSession>, String> {
  let stop = Arc::new(AtomicBool::new(false));
  let worker_stop = stop.clone();
  let (meter_resets, reset_requests) = tauri::async_runtime::channel(1);
  let progress = CaptureProgress::new(&frame_subscribers);
  let worker = std::thread::Builder::new()
    .name("live-mix".into())
    .spawn(move || {
      let layout = NativeLayout {
        roles: sources.routing.roles.clone(),
        speakers: None,
      };
      let channels = layout.roles.len() as u16;
      let dropped = Arc::new(AtomicU64::new(0));
      let diagnostics = app.state::<AppState>().ui_frame_diagnostics.clone();
      diagnostics.begin_mix();
      let pool = PcmBufferPool::new(
        PCM_QUEUE_CAP + 1,
        pooled_pcm_buffer_capacity(MIX_SAMPLE_RATE, channels),
      );
      let delivery = PcmDeliveryQueue::new(PCM_QUEUE_CAP);
      let forwarder = PcmCallbackForwarder::new(delivery.producer(), pool.clone(), dropped.clone());
      let meter_app = app.clone();
      let meter_dropped = dropped.clone();
      let meter_queue = delivery.clone();
      let meter_progress = progress.clone();
      let meter = std::thread::spawn(move || {
        run_meter_pipeline_bridge_thread(
          meter_queue.clone(),
          MIX_SAMPLE_RATE,
          channels,
          frame_subscribers,
          meter_app,
          reset_requests,
          Arc::new(Mutex::new(None)),
          dialogue_gating,
          dialogue_vad_engine,
          measured_pcm,
          true,
          meter_dropped,
          pool.clone(),
          Some(layout),
          meter_progress,
        );
        meter_queue.consumer_finished(&pool);
      });
      let result = run_mix(
        &sources,
        &capture,
        &worker_stop,
        &app,
        &diagnostics,
        &dropped,
        |pcm| {
          if !forwarder.forward_f32(pcm) {
            diagnostics.record_mix_drop(MixDropStage::AnalysisQueue, 1);
          }
        },
      );
      delivery.stop_producer();
      let _ = meter.join();
      if let Err(error) = result {
        emit_capture_failure(&app, &progress, &error, None);
      }
    })
    .map_err(|error| format!("could not start mix worker: {error}"))?;
  Ok(Box::new(LiveMixSession {
    stop,
    worker: Some(worker),
    meter_resets,
  }))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MixCaptureStatus<'a> {
  unavailable: &'a [&'a str],
  partial_at: Option<u64>,
}

fn run_mix(
  mix: &MixSources,
  capture: &(impl for<'a> Fn(Member<'a>) + Sync),
  stop: &AtomicBool,
  app: &AppHandle,
  diagnostics: &UiFrameDiagnosticsCounters,
  dropped: &AtomicU64,
  mut forward: impl FnMut(&[f32]),
) -> Result<(), String> {
  let sources = mix
    .applications
    .iter()
    .map(|id| Source::Application(id))
    .chain(mix.inputs.iter().map(Source::Input))
    .chain(
      mix
        .output
        .as_deref()
        .zip(mix.routing.output_roles.as_deref())
        .map(|(id, roles)| Source::Output(id, roles)),
    )
    .collect::<Vec<_>>();
  let ids = sources
    .iter()
    .map(|source| source.id().to_owned())
    .collect::<Vec<_>>();
  let ready = (0..ids.len())
    .map(|_| AtomicBool::new(false))
    .collect::<Vec<_>>();
  let channels = mix.routing.roles.len();
  std::thread::scope(|scope| {
    let (tx, rx) = mpsc::sync_channel(16 * ids.len());
    for (index, source) in sources.into_iter().enumerate() {
      let member = Member {
        source,
        routes: &mix.routing.routes[&ids[index]],
        stop,
        ready: &ready[index],
        tx: tx.clone(),
        index,
        diagnostics,
        dropped,
      };
      if let Err(error) = std::thread::Builder::new()
        .name("live-mix-member".into())
        .spawn_scoped(scope, move || capture(member))
      {
        stop.store(true, Ordering::Relaxed);
        return Err(format!("could not start mix member: {error}"));
      }
    }
    drop(tx);
    let mut last_report = Instant::now();
    let mut last_unavailable = None;
    let partial_at = std::cell::Cell::new(None);
    let mut packed = Vec::new();
    run_mix_timeline(
      rx,
      ids.len(),
      || {
        if last_report.elapsed() >= Duration::from_millis(250) {
          let unavailable = ids
            .iter()
            .zip(&ready)
            .filter(|(_, ready)| !ready.load(Ordering::Relaxed))
            .map(|(id, _)| id.as_str())
            .collect::<Vec<_>>();
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
        stop.load(Ordering::Relaxed)
      },
      |pcm, coverage| {
        if coverage.full + coverage.partial == 0 {
          return;
        }
        if (coverage.partial > 0 || coverage.empty > 0)
          && ready.iter().any(|member| !member.load(Ordering::Relaxed))
        {
          partial_at.set(
            SystemTime::now()
              .duration_since(UNIX_EPOCH)
              .ok()
              .map(|time| time.as_millis() as u64),
          );
        }
        packed.clear();
        for frame in pcm.as_chunks::<MAX_CHANNELS>().0 {
          packed.extend_from_slice(&frame[..channels]);
        }
        forward(&packed);
      },
      |insert| match insert {
        MixInsert::Overflow => {
          diagnostics.record_mix_drop(MixDropStage::TimelineOverflow, 1);
          dropped.fetch_add(1, Ordering::Relaxed);
        }
        MixInsert::Accepted { late_frames } if late_frames > 0 => {
          diagnostics.record_mix_drop(MixDropStage::LateFrames, late_frames as u64);
        }
        _ => {}
      },
    );
    stop.store(true, Ordering::Relaxed);
    Ok(())
  })
}
