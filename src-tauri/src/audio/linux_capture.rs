//! Linux single-source capture through the system PulseAudio client library.
//!
//! CPAL still discovers devices. The nonblocking libpulse loop lets Stop and a server disconnect
//! interrupt a quiet recording, including on PipeWire's PulseAudio server.

use std::cell::Cell;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::{Receiver, TryRecvError};
use std::time::{Duration, Instant};

use cpal::traits::DeviceTrait;
use libpulse_binding as pulse;
use pulse::context;
use pulse::def::BufferAttr;
use pulse::error::{Code, PAErr};
use pulse::sample::{Format, Spec};
use pulse::stream::{self, PeekResult, Stream};

use super::cpal_backend::{
  pooled_pcm_buffer_capacity, CaptureStreamArgs, PcmBufferPool, PcmCallbackForwarder,
  PcmDeliveryQueue, PCM_QUEUE_CAP, STREAM_ERROR_AUDIO_SERVICE, STREAM_ERROR_DEVICE_UNAVAILABLE,
  STREAM_ERROR_FORMAT, STREAM_ERROR_INVALIDATED, STREAM_ERROR_NONE, STREAM_ERROR_PERMISSION,
};
use super::linux_pulse_mix::Server;

const OPEN_TIMEOUT: Duration = Duration::from_secs(2);
const POLL: Duration = Duration::from_millis(2);

fn capture_error_code(error: PAErr) -> u8 {
  // libpulse context errno is positive, unlike negative return codes from stream operations.
  let error = if error.0 > 0 { PAErr(-error.0) } else { error };
  match Code::try_from(error) {
    Ok(Code::ConnectionRefused | Code::ConnectionTerminated) => STREAM_ERROR_AUDIO_SERVICE,
    Ok(Code::NoEntity) => STREAM_ERROR_DEVICE_UNAVAILABLE,
    // The server ended the stream. Recovery must recheck the same source before reopening it.
    Ok(Code::Killed) => STREAM_ERROR_INVALIDATED,
    Ok(Code::Access | Code::AuthKey) => STREAM_ERROR_PERMISSION,
    Ok(Code::NotSupported) => STREAM_ERROR_FORMAT,
    _ => STREAM_ERROR_NONE,
  }
}

fn capture_error(flag: Option<&AtomicU8>, operation: &str, error: PAErr) -> String {
  let code = capture_error_code(error);
  if code == STREAM_ERROR_AUDIO_SERVICE {
    super::linux_devices::refresh_discovery_connection();
  }
  if let Some(flag) = flag {
    flag.store(code, Ordering::Relaxed);
  }
  format!("{operation}: {error} (PulseAudio error {})", error.0)
}

struct Stop<'a> {
  rx: &'a Receiver<()>,
  requested: Cell<bool>,
}

impl Stop<'_> {
  fn requested(&self) -> bool {
    self.requested.get() || {
      let requested = !matches!(self.rx.try_recv(), Err(TryRecvError::Empty));
      self.requested.set(requested);
      requested
    }
  }
}

fn open_recording(
  source: &str,
  sample_rate: u32,
  channels: u16,
  frames_per_read: usize,
  stop: &Stop<'_>,
  flag: Option<&AtomicU8>,
) -> Result<Option<(Stream, Server)>, String> {
  let starting = Instant::now();
  let mut server = Server::connect("PLVS")
    .map_err(|error| capture_error(flag, "Cannot connect to the Linux audio service", error))?;
  loop {
    if stop.requested() {
      return Ok(None);
    }
    match server.context.get_state() {
      context::State::Ready => break,
      context::State::Failed | context::State::Terminated => {
        return Err(capture_error(
          flag,
          "Cannot connect to the Linux audio service",
          server.context.errno(),
        ));
      }
      _ if starting.elapsed() >= OPEN_TIMEOUT => {
        return Err("The Linux audio service did not respond while opening capture.".into());
      }
      _ => {
        server.pump()?;
        std::thread::sleep(POLL);
      }
    }
  }
  let map = match server.channel_map(source, &|| stop.requested()) {
    Ok(map) => map,
    Err(_) if stop.requested() => return Ok(None),
    Err(message) => return Err(message),
  };
  if u16::from(map.len()) != channels {
    if let Some(flag) = flag {
      flag.store(STREAM_ERROR_FORMAT, Ordering::Relaxed);
    }
    return Err("PulseAudio channel map does not match the capture format.".into());
  }
  let spec = Spec {
    format: Format::F32le,
    rate: sample_rate,
    channels: map.len(),
  };
  let mut stream = Stream::new(&mut server.context, "Live Metering", &spec, Some(&map))
    .ok_or("Cannot allocate the Linux audio capture stream.")?;
  let attr = BufferAttr {
    maxlength: u32::MAX,
    tlength: u32::MAX,
    prebuf: u32::MAX,
    minreq: u32::MAX,
    fragsize: (frames_per_read * usize::from(channels) * size_of::<f32>())
      .try_into()
      .map_err(|_| "Linux capture fragment is too large.")?,
  };
  stream
    .connect_record(
      Some(source),
      Some(&attr),
      stream::FlagSet::DONT_MOVE | stream::FlagSet::ADJUST_LATENCY,
    )
    .map_err(|error| capture_error(flag, "Cannot open Linux PulseAudio capture", error))?;
  let opening = Instant::now();
  loop {
    if stop.requested() {
      return Ok(None);
    }
    match stream.get_state() {
      stream::State::Ready => return Ok(Some((stream, server))),
      stream::State::Failed | stream::State::Terminated => {
        return Err(capture_error(
          flag,
          "Cannot open Linux PulseAudio capture",
          server.context.errno(),
        ));
      }
      _ if opening.elapsed() >= OPEN_TIMEOUT => {
        return Err("Linux PulseAudio capture did not start.".into());
      }
      _ => {
        server.pump()?;
        std::thread::sleep(POLL);
      }
    }
  }
}

pub(crate) fn run_capture_stream<C>(args: CaptureStreamArgs, consumer: C) -> Result<(), String>
where
  C: FnOnce(PcmDeliveryQueue, PcmBufferPool, u32, u16) + Send + 'static,
{
  let CaptureStreamArgs {
    device,
    sample_rate,
    channels,
    stop_rx,
    dropped_chunks,
    measured_pcm,
    monitoring_plan,
    stream_error,
    ..
  } = args;
  let flag = stream_error.as_deref();
  let source_id = device.id().map_err(|error| error.to_string())?;
  let stop = Stop {
    rx: &stop_rx,
    requested: Cell::new(false),
  };
  let frames_per_read = (sample_rate / 50).max(1) as usize;
  let Some((mut stream, mut server)) = open_recording(
    source_id.id(),
    sample_rate,
    channels,
    frames_per_read,
    &stop,
    flag,
  )?
  else {
    return Ok(());
  };

  let pcm_pool = PcmBufferPool::new(
    PCM_QUEUE_CAP + 1,
    pooled_pcm_buffer_capacity(sample_rate, channels),
  );
  let consumer_pool = pcm_pool.clone();
  let consumer_cleanup_pool = pcm_pool.clone();
  let delivery = PcmDeliveryQueue::new(PCM_QUEUE_CAP);
  let consumer_delivery = delivery.clone();
  let consumer_state = delivery.clone();
  let forwarder = PcmCallbackForwarder::new(delivery.producer(), pcm_pool, dropped_chunks.clone());
  let consumer_thread = std::thread::spawn(move || {
    consumer(consumer_delivery, consumer_pool, sample_rate, channels);
    consumer_state.consumer_finished(&consumer_cleanup_pool);
  });

  // Preserve the existing native cadence for measured PCM and the bounded meter queue.
  let samples_per_read = frames_per_read * usize::from(channels);
  let meter_samples_per_chunk = (sample_rate / 10).max(1) as usize * usize::from(channels);
  let mut pcm = Vec::with_capacity(samples_per_read);
  let mut meter_pcm = Vec::with_capacity(meter_samples_per_chunk + samples_per_read);
  let mut measured_scratch = Vec::new();
  let mut ingest_sample = |sample: f32| {
    pcm.push(sample);
    if pcm.len() < samples_per_read {
      return;
    }
    if let Some(measured_pcm) = measured_pcm.as_ref() {
      let (samples, monitored_channels) = match monitoring_plan.as_ref() {
        Some(plan) => (plan.pcm(&pcm, &mut measured_scratch), plan.channels()),
        None => (pcm.as_slice(), channels),
      };
      measured_pcm.publish(samples, sample_rate, monitored_channels);
    }
    meter_pcm.extend_from_slice(&pcm);
    pcm.clear();
    if meter_pcm.len() >= meter_samples_per_chunk {
      forwarder.forward_f32(&meter_pcm);
      meter_pcm.clear();
    }
  };

  let outcome = (|| {
    while !stop.requested() {
      server.pump()?;
      if !matches!(server.context.get_state(), context::State::Ready) {
        let error = server.context.errno();
        return Err(capture_error(
          flag,
          "Linux audio service disconnected",
          if error.0 == 0 {
            PAErr::from(Code::ConnectionTerminated)
          } else {
            error
          },
        ));
      }
      if stream.get_state() != stream::State::Ready {
        return Err(capture_error(
          flag,
          "Linux PulseAudio capture failed",
          server.context.errno(),
        ));
      }
      match stream
        .peek()
        .map_err(|error| capture_error(flag, "Linux PulseAudio read failed", error))?
      {
        PeekResult::Empty => {
          std::thread::sleep(POLL);
          continue;
        }
        PeekResult::Hole(bytes) => {
          for _ in 0..bytes / size_of::<f32>() {
            ingest_sample(0.0);
          }
        }
        PeekResult::Data(bytes) => {
          for &sample in bytes.as_chunks::<4>().0 {
            ingest_sample(f32::from_le_bytes(sample));
          }
        }
      }
      stream
        .discard()
        .map_err(|error| capture_error(flag, "Linux PulseAudio read failed", error))?;
    }
    Ok(())
  })();

  if !meter_pcm.is_empty() {
    forwarder.forward_f32(&meter_pcm);
  }
  let _ = stream.disconnect();
  drop(stream);
  delivery.stop_producer();
  let _ = consumer_thread.join();
  if outcome.is_err() {
    dropped_chunks.fetch_add(1, Ordering::Relaxed);
  }
  outcome
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn only_known_pulse_errors_receive_recovery_reasons() {
    assert_eq!(
      capture_error_code(Code::ConnectionTerminated.into()),
      STREAM_ERROR_AUDIO_SERVICE
    );
    assert_eq!(
      capture_error_code(PAErr(Code::ConnectionTerminated as i32)),
      STREAM_ERROR_AUDIO_SERVICE
    );
    assert_eq!(
      capture_error_code(Code::ConnectionRefused.into()),
      STREAM_ERROR_AUDIO_SERVICE
    );
    assert_eq!(
      capture_error_code(Code::NoEntity.into()),
      STREAM_ERROR_DEVICE_UNAVAILABLE
    );
    assert_eq!(
      capture_error_code(PAErr(Code::Killed as i32)),
      STREAM_ERROR_INVALIDATED
    );
    assert_eq!(
      capture_error_code(Code::Access.into()),
      STREAM_ERROR_PERMISSION
    );
    assert_eq!(
      capture_error_code(Code::NotSupported.into()),
      STREAM_ERROR_FORMAT
    );
    assert_eq!(capture_error_code(Code::Busy.into()), STREAM_ERROR_NONE);
  }
}
