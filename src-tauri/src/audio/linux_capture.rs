//! Linux live PCM capture through the system PulseAudio client library.
//!
//! Device discovery stays on CPAL so stable ids and the shared UI contract remain unchanged. The
//! pure-Rust Pulse protocol client used by CPAL 0.18 can create a PipeWire-Pulse record node that
//! never delivers buffers on Ubuntu 24.04 / PipeWire 1.0.5. `libpulse-simple` uses the system's
//! supported client protocol and supplies the same bounded worker queue without entering a Rust
//! callback on the audio server thread.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::sync::atomic::Ordering;

use cpal::traits::DeviceTrait;
use libloading::Library;

use super::cpal_backend::{
  pooled_pcm_buffer_capacity, CaptureStreamArgs, PcmBufferPool, PcmCallbackForwarder,
  PcmDeliveryQueue, PCM_QUEUE_CAP,
};

const PA_STREAM_RECORD: c_int = 2;
const PA_SAMPLE_FLOAT32LE: c_int = 5;

#[repr(C)]
struct SampleSpec {
  format: c_int,
  rate: u32,
  channels: u8,
}

#[repr(C)]
struct BufferAttr {
  maxlength: u32,
  tlength: u32,
  prebuf: u32,
  minreq: u32,
  fragsize: u32,
}

type SimpleNew = unsafe extern "C" fn(
  *const c_char,
  *const c_char,
  c_int,
  *const c_char,
  *const c_char,
  *const SampleSpec,
  *const c_void,
  *const BufferAttr,
  *mut c_int,
) -> *mut c_void;
type SimpleRead = unsafe extern "C" fn(*mut c_void, *mut c_void, usize, *mut c_int) -> c_int;
type SimpleFree = unsafe extern "C" fn(*mut c_void);
type StrError = unsafe extern "C" fn(c_int) -> *const c_char;

struct PulseApi {
  _simple: Library,
  _pulse: Library,
  new: SimpleNew,
  read: SimpleRead,
  free: SimpleFree,
  strerror: StrError,
}

impl PulseApi {
  fn load() -> Result<Self, String> {
    // SAFETY: the sonames and symbol signatures are the stable libpulse-simple C ABI.
    unsafe {
      let simple = Library::new("libpulse-simple.so.0")
        .map_err(|error| format!("Cannot load libpulse-simple.so.0: {error}"))?;
      let pulse = Library::new("libpulse.so.0")
        .map_err(|error| format!("Cannot load libpulse.so.0: {error}"))?;
      let new = *simple
        .get::<SimpleNew>(b"pa_simple_new\0")
        .map_err(|error| format!("Cannot load pa_simple_new: {error}"))?;
      let read = *simple
        .get::<SimpleRead>(b"pa_simple_read\0")
        .map_err(|error| format!("Cannot load pa_simple_read: {error}"))?;
      let free = *simple
        .get::<SimpleFree>(b"pa_simple_free\0")
        .map_err(|error| format!("Cannot load pa_simple_free: {error}"))?;
      let strerror = *pulse
        .get::<StrError>(b"pa_strerror\0")
        .map_err(|error| format!("Cannot load pa_strerror: {error}"))?;
      Ok(Self {
        _simple: simple,
        _pulse: pulse,
        new,
        read,
        free,
        strerror,
      })
    }
  }

  fn error(&self, operation: &str, code: c_int) -> String {
    // SAFETY: libpulse returns a static NUL-terminated error string for every integer code.
    let message = unsafe { CStr::from_ptr((self.strerror)(code)) }.to_string_lossy();
    format!("{operation}: {message} (PulseAudio error {code})")
  }
}

struct SimpleHandle {
  raw: *mut c_void,
  free: SimpleFree,
}

impl Drop for SimpleHandle {
  fn drop(&mut self) {
    // SAFETY: `raw` came from pa_simple_new and is freed exactly once after reads have stopped.
    unsafe { (self.free)(self.raw) };
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
    ..
  } = args;
  let source_id = device.id().map_err(|error| error.to_string())?;
  let source = CString::new(source_id.id())
    .map_err(|_| "Linux capture source id contains a NUL byte.".to_string())?;
  let application = CString::new("PLVS").expect("literal has no NUL");
  let stream_name = CString::new("Live Metering").expect("literal has no NUL");
  let api = PulseApi::load()?;
  let spec = SampleSpec {
    format: PA_SAMPLE_FLOAT32LE,
    rate: sample_rate,
    channels: channels
      .try_into()
      .map_err(|_| format!("Linux capture channel count is too large: {channels}"))?,
  };
  // Keep measured-source timestamps and final A/V duration precise at 20 ms while batching five
  // reads for the heavier meter pipeline. The callback-era shared pool is sized for 100 ms.
  let frames_per_read = (sample_rate / 50).max(1) as usize;
  let samples_per_read = frames_per_read.saturating_mul(channels as usize);
  let meter_samples_per_chunk = (sample_rate / 10).max(1) as usize * channels as usize;
  let bytes_per_read = samples_per_read.saturating_mul(std::mem::size_of::<f32>());
  let attr = BufferAttr {
    maxlength: u32::MAX,
    tlength: u32::MAX,
    prebuf: u32::MAX,
    minreq: u32::MAX,
    fragsize: bytes_per_read
      .try_into()
      .map_err(|_| "Linux capture fragment is too large.".to_string())?,
  };
  let mut error = 0;
  // SAFETY: every pointer references live C-compatible data for the duration of the call. The
  // returned opaque handle is owned by `SimpleHandle` and used serially on this worker thread.
  let raw = unsafe {
    (api.new)(
      std::ptr::null(),
      application.as_ptr(),
      PA_STREAM_RECORD,
      source.as_ptr(),
      stream_name.as_ptr(),
      &spec,
      std::ptr::null(),
      &attr,
      &mut error,
    )
  };
  if raw.is_null() {
    return Err(api.error("Cannot open Linux PulseAudio capture", error));
  }
  let handle = SimpleHandle {
    raw,
    free: api.free,
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
  let mut pcm = vec![0.0_f32; samples_per_read];
  let mut meter_pcm = Vec::with_capacity(meter_samples_per_chunk);
  let outcome = loop {
    match stop_rx.try_recv() {
      Ok(()) | Err(std::sync::mpsc::TryRecvError::Disconnected) => break Ok(()),
      Err(std::sync::mpsc::TryRecvError::Empty) => {}
    }
    error = 0;
    // SAFETY: `pcm` owns `bytes_per_read` writable bytes and this handle is used on one thread.
    let status = unsafe {
      (api.read)(
        handle.raw,
        pcm.as_mut_ptr().cast(),
        bytes_per_read,
        &mut error,
      )
    };
    if status < 0 {
      break Err(api.error("Linux PulseAudio capture failed", error));
    }
    if let Some(measured_pcm) = measured_pcm.as_ref() {
      measured_pcm.publish(&pcm, sample_rate, channels);
    }
    meter_pcm.extend_from_slice(&pcm);
    if meter_pcm.len() >= meter_samples_per_chunk {
      forwarder.forward_f32(&meter_pcm);
      meter_pcm.clear();
    }
  };
  if !meter_pcm.is_empty() {
    forwarder.forward_f32(&meter_pcm);
  }
  drop(handle);
  delivery.stop_producer();
  let _ = consumer_thread.join();
  if outcome.is_err() {
    dropped_chunks.fetch_add(1, Ordering::Relaxed);
  }
  outcome
}
