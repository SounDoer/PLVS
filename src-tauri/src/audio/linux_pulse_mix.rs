//! Full libpulse record streams for mix members and playback-stream discovery.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cpal::traits::DeviceTrait;
use libpulse_binding as pulse;
use pulse::callbacks::ListResult;
use pulse::channelmap;
use pulse::context::{self, Context};
use pulse::def::BufferAttr;
use pulse::mainloop::standard::{IterateResult, Mainloop};
use pulse::operation;
use pulse::sample::{self, Spec};
use pulse::stream::{self, Latency, PeekResult, Stream};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::capture::{AudioCaptureSession, MeasuredPcmSubscriptions};
use super::device_enum::resolve_device;
use super::live_mix::{self, Member, MixSources, Source};
use super::source_layout::device_plan;
use super::stereo_mix_timeline::MIX_SAMPLE_RATE;
use crate::dsp::speech::VadEngineKind;
use crate::ipc::types::FrameSubscribers;
use crate::state::MixDropStage;

const START_TIMEOUT: Duration = Duration::from_secs(2);
const POLL: Duration = Duration::from_millis(2);
const TICKS_PER_SECOND: u64 = 10_000_000;

struct Server {
  context: Context,
  mainloop: Mainloop,
}

impl Server {
  fn open(stopped: &impl Fn() -> bool) -> Result<Self, String> {
    let mainloop = Mainloop::new().ok_or("Could not allocate a PulseAudio main loop.")?;
    let mut context =
      Context::new(&mainloop, "PLVS Mix").ok_or("Could not create a PulseAudio context.")?;
    context
      .connect(None, context::FlagSet::NOAUTOSPAWN, None)
      .map_err(|error| format!("{error}"))?;
    let mut server = Self { context, mainloop };
    let start = Instant::now();
    loop {
      match server.context.get_state() {
        context::State::Ready => return Ok(server),
        context::State::Failed | context::State::Terminated => {
          return Err("PulseAudio Mix connection failed.".into());
        }
        _ if stopped() || start.elapsed() >= START_TIMEOUT => {
          return Err("PulseAudio Mix connection did not start.".into());
        }
        _ => {
          server.pump()?;
          std::thread::sleep(POLL);
        }
      }
    }
  }

  fn pump(&mut self) -> Result<(), String> {
    match self.mainloop.iterate(false) {
      IterateResult::Success(_) => Ok(()),
      _ => Err("PulseAudio Mix main loop stopped.".into()),
    }
  }

  fn wait_operation<F: ?Sized>(
    &mut self,
    operation: &mut operation::Operation<F>,
    stopped: &impl Fn() -> bool,
  ) -> Result<(), String> {
    let start = Instant::now();
    while operation.get_state() == operation::State::Running {
      if stopped() || start.elapsed() >= START_TIMEOUT {
        operation.cancel();
        return Err("PulseAudio Mix inventory did not complete.".into());
      }
      self.pump()?;
      std::thread::sleep(POLL);
    }
    Ok(())
  }

  fn playback(&mut self, stopped: &impl Fn() -> bool) -> Result<Vec<Playback>, String> {
    let rows = Rc::new(RefCell::new(Vec::new()));
    let collected = rows.clone();
    let mut op = self
      .context
      .introspect()
      .get_sink_input_info_list(move |entry| {
        let ListResult::Item(info) = entry else {
          return;
        };
        let props = &info.proplist;
        let Some(process) = props
          .get_str("application.process.id")
          .and_then(|value| value.parse::<u32>().ok())
        else {
          return;
        };
        let binary = props
          .get_str("application.process.binary")
          .unwrap_or_default();
        let app_id = props.get_str("application.id").unwrap_or_default();
        let label = props
          .get_str("application.name")
          .filter(|name| !name.trim().is_empty());
        let Some(label) = label.or_else(|| (!binary.is_empty()).then(|| binary.clone())) else {
          return;
        };
        let identity = if !app_id.is_empty() {
          &app_id
        } else if !binary.is_empty() {
          &binary
        } else {
          &label
        };
        collected.borrow_mut().push(Playback {
          index: info.index,
          sink: info.sink,
          corked: info.corked,
          id: application_id(identity),
          label,
          process,
        });
      });
    self.wait_operation(&mut op, stopped)?;
    let result = std::mem::take(&mut *rows.borrow_mut());
    Ok(result)
  }

  fn monitor_name(&mut self, sink: u32, stopped: &impl Fn() -> bool) -> Result<String, String> {
    let name = Rc::new(RefCell::new(None));
    let result = name.clone();
    let mut op = self
      .context
      .introspect()
      .get_sink_info_by_index(sink, move |entry| {
        if let ListResult::Item(info) = entry {
          *result.borrow_mut() = info.monitor_source_name.as_ref().map(ToString::to_string);
        }
      });
    self.wait_operation(&mut op, stopped)?;
    let result = name.borrow_mut().take();
    result.ok_or_else(|| "The application's playback sink has no monitor source.".into())
  }

  fn channel_map(
    &mut self,
    source: &str,
    stopped: &impl Fn() -> bool,
  ) -> Result<channelmap::Map, String> {
    let map = Rc::new(RefCell::new(None));
    let result = map.clone();
    let mut op = self
      .context
      .introspect()
      .get_source_info_by_name(source, move |entry| {
        if let ListResult::Item(info) = entry {
          *result.borrow_mut() = Some(info.channel_map);
        }
      });
    self.wait_operation(&mut op, stopped)?;
    let result = map.borrow_mut().take();
    result.ok_or_else(|| "PulseAudio capture source is unavailable.".into())
  }
}

struct Playback {
  index: u32,
  sink: u32,
  corked: bool,
  id: String,
  label: String,
  process: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaptureApplication {
  id: String,
  label: String,
  process_id: u32,
  process_ids: Vec<u32>,
  window_title: String,
}

fn application_id(identity: &str) -> String {
  let mut id = String::from("app-");
  for byte in &Sha256::digest(format!("linux:{}", identity.trim().to_lowercase()))[..16] {
    use std::fmt::Write;
    let _ = write!(id, "{byte:02x}");
  }
  id
}

pub(crate) fn is_application_id(value: &str) -> bool {
  value.len() == 36
    && value.starts_with("app-")
    && value.as_bytes()[4..].iter().all(u8::is_ascii_hexdigit)
}

pub(crate) fn list_capture_applications() -> Result<Vec<CaptureApplication>, String> {
  let stopped = || false;
  let mut applications = BTreeMap::new();
  for item in Server::open(&stopped)?.playback(&stopped)? {
    let app = applications
      .entry(item.id.clone())
      .or_insert_with(|| CaptureApplication {
        id: item.id,
        label: item.label,
        process_id: item.process,
        process_ids: Vec::new(),
        window_title: String::new(),
      });
    app.process_ids.push(item.process);
  }
  let mut applications = applications.into_values().collect::<Vec<_>>();
  for app in &mut applications {
    app.process_ids.sort_unstable();
    app.process_ids.dedup();
    app.process_id = app.process_ids[0];
  }
  applications.sort_by_cached_key(|app| app.label.to_lowercase());
  Ok(applications)
}

struct Recording {
  stream: Stream,
  channels: usize,
  next_frame: Option<u64>,
  last_read: Instant,
}

impl Recording {
  fn open(
    server: &mut Server,
    source: &str,
    map: channelmap::Map,
    selected: Option<u32>,
  ) -> Result<Self, String> {
    let channels = map.len();
    let spec = Spec {
      format: sample::Format::FLOAT32NE,
      rate: MIX_SAMPLE_RATE,
      channels,
    };
    let mut stream = Stream::new(&mut server.context, "PLVS Mix", &spec, Some(&map))
      .ok_or("Could not create a PulseAudio record stream.")?;
    if let Some(index) = selected {
      stream
        .set_monitor_stream(index)
        .map_err(|error| format!("{error}"))?;
    }
    let flags = stream::FlagSet::AUTO_TIMING_UPDATE
      | stream::FlagSet::DONT_MOVE
      | stream::FlagSet::ADJUST_LATENCY;
    let attr = BufferAttr {
      maxlength: (MIX_SAMPLE_RATE / 5) * 4 * u32::from(channels),
      fragsize: (MIX_SAMPLE_RATE / 100) * 4 * u32::from(channels),
      ..BufferAttr::default()
    };
    stream
      .connect_record(Some(source), Some(&attr), flags)
      .map_err(|error| format!("{error}"))?;
    Ok(Self {
      stream,
      channels: usize::from(channels),
      next_frame: None,
      last_read: Instant::now(),
    })
  }

  fn read(&mut self, member: &Member<'_>) -> Result<Option<(u64, Vec<f32>)>, String> {
    let before = self.stream.get_state();
    if !matches!(before, stream::State::Creating | stream::State::Ready) {
      return Err("PulseAudio Mix capture stream disconnected.".into());
    }
    if before == stream::State::Creating {
      return Ok(None);
    }
    let timing = self.stream.get_latency().ok();
    let readable = self.stream.readable_size().unwrap_or(0) / (4 * self.channels);
    if readable == 0 {
      return Ok(None);
    }
    let now =
      monotonic_ticks().inspect_err(|_| member.record_drop(MixDropStage::InvalidTimestamp))?;
    let end = now
      + match timing {
        Some(Latency::Negative(value)) => value.0 * 10,
        _ => 0,
      };
    let latency = match timing {
      Some(Latency::Positive(value)) => value.0 * 10,
      Some(_) => 0,
      None => frames_to_ticks(readable as u64),
    };
    let estimated = ticks_to_frames(end.saturating_sub(latency));
    let start = self
      .next_frame
      .filter(|_| self.last_read.elapsed() < Duration::from_millis(200))
      .unwrap_or(estimated);
    let samples = match self.stream.peek().map_err(|error| format!("{error}"))? {
      PeekResult::Empty => return Ok(None),
      PeekResult::Hole(bytes) => vec![0.0; bytes / 4],
      PeekResult::Data(bytes) => bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|&value| f32::from_ne_bytes(value))
        .collect(),
    };
    self.stream.discard().map_err(|error| format!("{error}"))?;
    self.last_read = Instant::now();
    self.next_frame = Some(start + (samples.len() / self.channels) as u64);
    Ok(Some((start, samples)))
  }
}

fn monotonic_ticks() -> Result<u64, String> {
  let mut now = libc::timespec {
    tv_sec: 0,
    tv_nsec: 0,
  };
  if unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut now) } != 0 {
    return Err("Linux monotonic capture clock is unavailable.".into());
  }
  Ok(now.tv_sec as u64 * TICKS_PER_SECOND + now.tv_nsec as u64 / 100)
}

fn frames_to_ticks(frames: u64) -> u64 {
  frames * TICKS_PER_SECOND / u64::from(MIX_SAMPLE_RATE)
}

fn ticks_to_frames(ticks: u64) -> u64 {
  (ticks * u64::from(MIX_SAMPLE_RATE) + TICKS_PER_SECOND / 2) / TICKS_PER_SECOND
}

fn capture(member: Member<'_>) {
  while !member.stopped() {
    let result = match &member.source {
      Source::Application(id) => capture_application(&member, id),
      Source::Input(input) => capture_device(&member, &input.id, None, &input.channels),
      Source::Output(id, roles) => capture_device(&member, id, Some(roles), &[]),
    };
    member.set_ready(false);
    if let Err(error) = result {
      log::debug!("PulseAudio Mix member unavailable: {error}");
    }
    for _ in 0..5 {
      if member.stopped() {
        return;
      }
      std::thread::sleep(Duration::from_millis(100));
    }
  }
}

fn capture_device(
  member: &Member<'_>,
  id: &str,
  roles: Option<&[String]>,
  selected: &[u16],
) -> Result<(), String> {
  let (device, config) = resolve_device(id)?;
  let plan = device_plan(&device, config.channels(), roles.is_some());
  if roles.is_some() && plan.roles.as_deref() != roles {
    return Err("Mix playback device channel mapping has changed.".into());
  }
  let indices = if roles.is_some() {
    plan.indices
  } else {
    selected.iter().map(|&index| usize::from(index)).collect()
  };
  let source = device.id().map_err(|error| error.to_string())?;
  let stopped = || member.stopped();
  let mut server = Server::open(&stopped)?;
  let map = server.channel_map(source.id(), &stopped)?;
  if indices.iter().any(|&index| index >= usize::from(map.len())) {
    return Err("Mix input channel disappeared.".into());
  }
  let mut recording = Recording::open(&mut server, source.id(), map, None)?;
  let mut activity = Instant::now();
  while !stopped() {
    server.pump()?;
    if let Some((start, pcm)) = recording.read(member)? {
      let frames = pcm
        .chunks_exact(recording.channels)
        .map(|frame| member.project(indices.iter().map(|&index| frame[index])))
        .collect();
      member.send(None, frames_to_ticks(start), None, frames);
      member.set_ready(true);
      activity = Instant::now();
    } else if activity.elapsed() >= Duration::from_secs(5) {
      return Err("Mix input stopped delivering PCM.".into());
    } else {
      std::thread::sleep(POLL);
    }
  }
  Ok(())
}

fn capture_application(member: &Member<'_>, id: &str) -> Result<(), String> {
  let stopped = || member.stopped();
  let mut server = Server::open(&stopped)?;
  let targets = |server: &mut Server| {
    let mut streams = server
      .playback(&stopped)?
      .into_iter()
      .filter(|row| row.id == id)
      .collect::<Vec<_>>();
    streams.sort_unstable_by_key(|stream| stream.index);
    Ok::<_, String>(streams)
  };
  let initial = targets(&mut server)?;
  if initial.is_empty() {
    return Err("The Mix application has no playback streams.".into());
  }
  let target_key = |stream: &Playback| (stream.index, stream.sink);
  let mut channel_map = channelmap::Map::default();
  channel_map.init_stereo();
  let mut recordings = Vec::new();
  for target in &initial {
    let monitor = server.monitor_name(target.sink, &stopped)?;
    recordings.push(Recording::open(
      &mut server,
      &monitor,
      channel_map,
      Some(target.index),
    )?);
  }
  let mut interval = Instant::now();
  let mut activity = Instant::now();
  while !stopped() {
    server.pump()?;
    for (target, recorder) in initial.iter().zip(&mut recordings) {
      while let Some((start, frames)) = recorder.read(member)? {
        activity = Instant::now();
        let routed = frames
          .as_chunks::<2>()
          .0
          .iter()
          .map(|frame| member.project(*frame))
          .collect();
        member.send(Some(target.index), frames_to_ticks(start), None, routed);
      }
    }
    member.set_ready(
      recordings
        .iter()
        .all(|stream| stream.stream.get_state() == stream::State::Ready),
    );
    if interval.elapsed() >= Duration::from_millis(500) {
      interval = Instant::now();
      let current = targets(&mut server)?;
      if initial
        .iter()
        .map(target_key)
        .ne(current.iter().map(target_key))
      {
        return Ok(());
      }
      if current.iter().all(|stream| stream.corked) {
        // The playback stream still exists while its application has paused it.
        activity = Instant::now();
      } else if activity.elapsed() >= Duration::from_secs(5) {
        return Err("The Mix application's record streams delivered no PCM.".into());
      }
    }
    std::thread::sleep(POLL);
  }
  Ok(())
}

pub(crate) fn start_mix(
  sources: MixSources,
  frame_subscribers: FrameSubscribers,
  app: AppHandle,
  dialogue_gating: Arc<Mutex<bool>>,
  dialogue_vad_engine: Arc<Mutex<VadEngineKind>>,
  measured_pcm: Arc<MeasuredPcmSubscriptions>,
) -> Result<Box<dyn AudioCaptureSession>, String> {
  live_mix::start(
    sources,
    capture,
    frame_subscribers,
    app,
    dialogue_gating,
    dialogue_vad_engine,
    measured_pcm,
  )
}

pub(crate) fn start_application(
  id: String,
  frame_subscribers: FrameSubscribers,
  app: AppHandle,
  dialogue_gating: Arc<Mutex<bool>>,
  dialogue_vad_engine: Arc<Mutex<VadEngineKind>>,
  measured_pcm: Arc<MeasuredPcmSubscriptions>,
) -> Result<Box<dyn AudioCaptureSession>, String> {
  if !is_application_id(&id) {
    return Err("Invalid capture application ID.".into());
  }
  let routing = super::capture::MixRouting {
    roles: vec!["L".into(), "R".into()],
    routes: [(id.clone(), vec![vec![(0, 1.0)], vec![(1, 1.0)]])].into(),
    output_roles: None,
  };
  start_mix(
    MixSources {
      applications: vec![id],
      inputs: Vec::new(),
      output: None,
      routing,
    },
    frame_subscribers,
    app,
    dialogue_gating,
    dialogue_vad_engine,
    measured_pcm,
  )
}
