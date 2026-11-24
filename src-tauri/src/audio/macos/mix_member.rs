//! Timestamped Core Audio members, with all routing and resampling off the IOProc.

use std::ffi::{c_void, CString};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, StreamTrait};
use crossbeam_queue::ArrayQueue;

use super::{
  layout_for_uid, macos_process_is_running_output, macos_tap_create, macos_tap_destroy,
  macos_tap_format, output_stream_count, resolve_tap_output,
};
use crate::audio::cpal_backend::{pooled_pcm_buffer_capacity, PcmBufferPool, PCM_QUEUE_CAP};
use crate::audio::device_enum::resolve_device;
use crate::audio::live_mix::{Member, MemberPcm, Source};
use crate::audio::macos_capture_apps::resolve_capture_application;
use crate::audio::source_layout::MonitoringPlan;
use crate::state::MixDropStage;

#[link(name = "CoreAudio", kind = "framework")]
unsafe extern "C" {
  fn AudioConvertHostTimeToNanos(host_time: u64) -> u64;
}

struct Packet {
  stamp: u64,
  samples: Vec<f32>,
}

struct Queue {
  pcm: ArrayQueue<Packet>,
  pool: PcmBufferPool,
  rejected: AtomicU64,
  channels: u16,
}

impl Queue {
  fn new(rate: u32, channels: u16) -> Self {
    Self {
      pcm: ArrayQueue::new(PCM_QUEUE_CAP),
      pool: PcmBufferPool::new(
        PCM_QUEUE_CAP + 1,
        pooled_pcm_buffer_capacity(rate, channels),
      ),
      rejected: AtomicU64::new(0),
      channels,
    }
  }

  fn push<T: Copy>(&self, stamp: u64, data: &[T], convert: impl Fn(T) -> f32) {
    let Some(mut samples) = self.pool.checkout() else {
      self.rejected.fetch_add(1, Ordering::Relaxed);
      return;
    };
    if data.len() > samples.capacity() {
      self.rejected.fetch_add(1, Ordering::Relaxed);
      self.pool.recycle(samples);
      return;
    }
    samples.extend(data.iter().copied().map(convert));
    if let Err(packet) = self.pcm.push(Packet { stamp, samples }) {
      self.rejected.fetch_add(1, Ordering::Relaxed);
      self.pool.recycle(packet.samples);
    }
  }
}

unsafe extern "C" fn tap_pcm(
  userdata: *mut c_void,
  data: *const f32,
  frames: u32,
  channels: u32,
  host_time: u64,
) {
  // The queue belongs to the capture worker and is retained until the IOProc is destroyed.
  let queue = unsafe { &*userdata.cast::<Queue>() };
  if channels != u32::from(queue.channels) || frames == 0 || data.is_null() {
    queue.rejected.fetch_add(1, Ordering::Relaxed);
    return;
  }
  let samples = unsafe { std::slice::from_raw_parts(data, frames as usize * channels as usize) };
  queue.push(host_time, samples, |sample| sample);
}

struct Tap(*mut c_void);

impl Drop for Tap {
  fn drop(&mut self) {
    unsafe { macos_tap_destroy(self.0, std::ptr::null_mut()) };
  }
}

fn open_tap(uid: Option<&str>, processes: &[u32], queue: &Queue) -> Result<Tap, String> {
  let uid = uid
    .map(CString::new)
    .transpose()
    .map_err(|_| "Invalid Core Audio output UID.")?;
  let mut error = [0u8; 512];
  let tap = unsafe {
    macos_tap_create(
      uid.as_ref().map_or(std::ptr::null(), |uid| uid.as_ptr()),
      0,
      processes.as_ptr(),
      processes.len(),
      tap_pcm,
      (queue as *const Queue).cast_mut().cast(),
      error.as_mut_ptr().cast(),
      error.len(),
    )
  };
  if tap.is_null() {
    let length = error
      .iter()
      .position(|&byte| byte == 0)
      .unwrap_or(error.len());
    return Err(String::from_utf8_lossy(&error[..length]).into_owned());
  }
  Ok(Tap(tap))
}

pub(in crate::audio) fn capture(member: Member<'_>) {
  while !member.stopped() {
    let result = match &member.source {
      Source::Application(id) => capture_application(&member, id),
      Source::Input(input) => capture_input(&member, &input.id, &input.channels),
      Source::Output(id, roles) => capture_output(&member, id, roles),
    };
    member.set_ready(false);
    if let Err(error) = result {
      log::debug!("Core Audio Mix member unavailable: {error}");
    }
    for _ in 0..5 {
      if member.stopped() {
        return;
      }
      std::thread::sleep(Duration::from_millis(100));
    }
  }
}

fn capture_application(member: &Member<'_>, id: &str) -> Result<(), String> {
  let processes = process_objects(id)?;
  let queue = Queue::new(192_000, 2);
  let tap = open_tap(None, &processes, &queue)?;
  member.set_ready(true);
  read_tap(
    member,
    &tap,
    &queue,
    |frame| member.project(frame.iter().copied()),
    |last_packet| {
      let active_stall = last_packet >= Duration::from_secs(2)
        && processes
          .iter()
          .any(|&id| unsafe { macos_process_is_running_output(id) });
      Ok(!active_stall && process_objects(id)? == processes)
    },
    || {},
  )
}

fn capture_output(
  member: &Member<'_>,
  device_id: &str,
  expected_roles: &[String],
) -> Result<(), String> {
  let output = resolve_tap_output(device_id)?;
  if output_stream_count(&output.uid) != Some(1) {
    return Err("Mix tap requires a single-stream output.".into());
  }
  let channels = output.config.channels();
  let native = layout_for_uid(&output.uid, channels);
  let plan = MonitoringPlan::require_system_scope(channels, native.clone())?;
  if plan.roles.as_deref() != Some(expected_roles) {
    return Err("Mix playback device channel mapping has changed.".into());
  }
  let queue = Queue::new(output.config.sample_rate(), channels);
  let tap = open_tap(Some(&output.uid), &[], &queue)?;
  let primer_flag = Arc::new(std::sync::atomic::AtomicU8::new(0));
  let mut primer = crate::audio::cpal_backend::create_silence_output_stream(
    &output.device,
    &output.config.config(),
    primer_flag,
  );
  read_tap(
    member,
    &tap,
    &queue,
    |frame| member.project(plan.indices.iter().map(|&index| frame[index])),
    |last_packet| {
      if last_packet >= Duration::from_secs(5) {
        return Err("Mix output stopped delivering PCM.".into());
      }
      let current = resolve_tap_output(device_id)?;
      Ok(
        current.uid == output.uid
          && current.config == output.config
          && layout_for_uid(&current.uid, channels) == native,
      )
    },
    || {
      primer.take();
    },
  )
}

fn tap_format(tap: &Tap) -> Result<(u32, u32), String> {
  let mut rate = 0;
  let mut channels = 0;
  if unsafe { macos_tap_format(tap.0, &mut rate, &mut channels) } != 0 {
    return Err("Could not read the Core Audio Mix tap format.".into());
  }
  Ok((rate, channels))
}

fn read_tap(
  member: &Member<'_>,
  tap: &Tap,
  queue: &Queue,
  project: impl Fn(&[f32]) -> [f32; 16],
  mut still_bound: impl FnMut(Duration) -> Result<bool, String>,
  mut on_pcm: impl FnMut(),
) -> Result<(), String> {
  let (sample_rate, channels) = tap_format(tap)?;
  if channels != u32::from(queue.channels) {
    return Err("The Core Audio Mix tap returned an unexpected channel count.".into());
  }
  let mut pcm = MemberPcm::new(member, sample_rate)?;
  let mut checked = Instant::now();
  let mut last_packet = Instant::now();
  while !member.stopped() {
    if let Some(packet) = queue.pcm.pop() {
      last_packet = Instant::now();
      let timestamp = unsafe { AudioConvertHostTimeToNanos(packet.stamp) } / 100;
      pcm.push(
        timestamp,
        packet.samples.chunks_exact(channels as usize).map(&project),
      )?;
      queue.pool.recycle(packet.samples);
      member.set_ready(true);
      on_pcm();
    } else {
      std::thread::sleep(Duration::from_millis(2));
    }
    member.record_drops(
      MixDropStage::IngressQueue,
      queue.rejected.swap(0, Ordering::Relaxed),
    );
    if checked.elapsed() >= Duration::from_millis(500) {
      checked = Instant::now();
      if tap_format(tap)? != (sample_rate, channels) || !still_bound(last_packet.elapsed())? {
        return Ok(());
      }
    }
  }
  Ok(())
}

fn process_objects(id: &str) -> Result<Vec<u32>, String> {
  let resolved = resolve_capture_application(id)?;
  let mut objects = resolved.audio_process_object_ids;
  objects.sort_unstable();
  objects.dedup();
  if objects.is_empty() {
    return Err("Mix application has no active Core Audio process objects.".into());
  }
  Ok(objects)
}

fn capture_input(member: &Member<'_>, id: &str, selected: &[u16]) -> Result<(), String> {
  let (device, config) = resolve_device(id)?;
  let channels = config.channels();
  if selected.iter().any(|&channel| channel >= channels) {
    return Err("Mix input channel disappeared.".into());
  }
  let queue = Arc::new(Queue::new(config.sample_rate(), channels));
  let callback_queue = queue.clone();
  let failed = Arc::new(AtomicBool::new(false));
  let callback_failed = failed.clone();
  let stream = device
    .build_input_stream_raw(
      config.config(),
      config.sample_format(),
      move |data, info| {
        let stamp = (info.timestamp().capture.as_nanos() / 100) as u64;
        if let Some(samples) = data.as_slice::<f32>() {
          callback_queue.push(stamp, samples, |sample| sample);
        } else if let Some(samples) = data.as_slice::<i16>() {
          callback_queue.push(stamp, samples, |sample| f32::from(sample) / 32768.0);
        } else if let Some(samples) = data.as_slice::<u16>() {
          callback_queue.push(stamp, samples, |sample| {
            (f32::from(sample) - 32768.0) / 32768.0
          });
        } else {
          callback_failed.store(true, Ordering::Relaxed);
        }
      },
      {
        let failed = failed.clone();
        move |_| failed.store(true, Ordering::Relaxed)
      },
      None,
    )
    .map_err(|e| e.to_string())?;
  stream.play().map_err(|e| e.to_string())?;
  let mut pcm = MemberPcm::new(member, config.sample_rate())?;
  let mut last_packet = Instant::now();
  while !member.stopped() {
    if failed.load(Ordering::Relaxed) || last_packet.elapsed() >= Duration::from_secs(5) {
      return Err("Mix input stopped delivering PCM.".into());
    }
    if let Some(packet) = queue.pcm.pop() {
      last_packet = Instant::now();
      let frames = packet
        .samples
        .chunks_exact(usize::from(channels))
        .map(|frame| member.project(selected.iter().map(|&channel| frame[usize::from(channel)])));
      pcm.push(packet.stamp, frames)?;
      queue.pool.recycle(packet.samples);
      member.set_ready(true);
    } else {
      std::thread::sleep(Duration::from_millis(2));
    }
    member.record_drops(
      MixDropStage::IngressQueue,
      queue.rejected.swap(0, Ordering::Relaxed),
    );
  }
  Ok(())
}
