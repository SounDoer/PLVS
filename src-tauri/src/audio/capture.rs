//! `AudioCapture` abstraction over platform backends (see `docs/architecture.md` §5).
//!
//! Concrete backends: `cpal_backend` (WASAPI loopback + inputs), `platform_backend::AppAudioBackend` (dispatches to Core Audio tap on macOS).

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use crossbeam_queue::ArrayQueue;
use tauri::AppHandle;

use super::device::DeviceInfo;
use crate::dsp::speech::VadEngineKind;
use crate::engine::ChannelLayoutSetting;
use crate::ipc::types::FrameSubscribers;

/// One PCM buffer from the device; channel count is never hard-coded to stereo.
#[derive(Clone, Debug, PartialEq)]
pub struct PcmFrame {
  pub samples: Vec<f32>,
  pub channels: u16,
  pub sample_rate: u32,
  pub timestamp_ns: u64,
  pub sequence: u64,
  pub dropped_before: u64,
  pub channel_layout: ChannelLayoutSetting,
}

struct MeasuredPcmSubscriber {
  queue: ArrayQueue<PcmFrame>,
  pool: ArrayQueue<Vec<f32>>,
  dropped: AtomicU64,
  active: AtomicBool,
}

const MAX_PCM_TIMESTAMP_JITTER_NS: u64 = 50_000_000;

#[derive(Default)]
struct PcmTimestampClock {
  next_ns: Option<u64>,
  sample_rate: u32,
}

impl PcmTimestampClock {
  fn place(&mut self, observed_end_ns: u64, frame_count: usize, sample_rate: u32) -> u64 {
    if sample_rate == 0 {
      self.next_ns = None;
      self.sample_rate = 0;
      return observed_end_ns;
    }
    let duration_ns = (frame_count as u64).saturating_mul(1_000_000_000) / u64::from(sample_rate);
    let observed_start_ns = observed_end_ns.saturating_sub(duration_ns);
    let timestamp_ns = match self.next_ns {
      Some(expected_ns)
        if self.sample_rate == sample_rate
          && expected_ns.abs_diff(observed_start_ns) <= MAX_PCM_TIMESTAMP_JITTER_NS =>
      {
        expected_ns
      }
      _ => observed_start_ns,
    };
    self.next_ns = Some(timestamp_ns.saturating_add(duration_ns));
    self.sample_rate = sample_rate;
    timestamp_ns
  }
}

/// Runtime registry for worker-side consumers of the same source PCM that PLVS meters.
///
/// Publishing happens only after the realtime callback has handed its pooled buffer to the normal
/// capture worker. Each subscriber owns a separate bounded queue and recycling pool, so recorder
/// backpressure cannot consume meter buffers or delay the metering pipeline.
pub struct MeasuredPcmSubscriptions {
  epoch: Instant,
  sequence: AtomicU64,
  timestamp_clock: Mutex<PcmTimestampClock>,
  subscribers: Mutex<Vec<Weak<MeasuredPcmSubscriber>>>,
}

impl Default for MeasuredPcmSubscriptions {
  fn default() -> Self {
    Self {
      epoch: Instant::now(),
      sequence: AtomicU64::new(0),
      timestamp_clock: Mutex::new(PcmTimestampClock::default()),
      subscribers: Mutex::new(Vec::new()),
    }
  }
}

impl MeasuredPcmSubscriptions {
  pub fn timestamp_ns(&self) -> u64 {
    self.epoch.elapsed().as_nanos().min(u128::from(u64::MAX)) as u64
  }

  pub fn subscribe(&self, capacity: usize) -> Result<MeasuredPcmReceiver, &'static str> {
    if capacity == 0 {
      return Err("subscriberCapacityZero");
    }
    let queue = ArrayQueue::new(capacity);
    let pool = ArrayQueue::new(capacity.saturating_add(1));
    for _ in 0..capacity.saturating_add(1) {
      pool
        .push(Vec::new())
        .expect("new measured PCM pool has one slot per buffer");
    }
    let inner = Arc::new(MeasuredPcmSubscriber {
      queue,
      pool,
      dropped: AtomicU64::new(0),
      active: AtomicBool::new(true),
    });
    self
      .subscribers
      .lock()
      .map_err(|_| "subscriberStateUnavailable")?
      .push(Arc::downgrade(&inner));
    Ok(MeasuredPcmReceiver { inner })
  }

  pub(crate) fn publish(
    &self,
    samples: &[f32],
    sample_rate: u32,
    channels: u16,
    channel_layout: ChannelLayoutSetting,
  ) {
    let frame_count = samples.len() / usize::from(channels.max(1));
    // The device callback cadence jitters even when its PCM is continuous. Anchor the first buffer
    // to the worker's monotonic clock, then advance by sample count until a real gap or sample-rate
    // transition occurs. Otherwise alternating late/early callbacks become false silence plus
    // trimmed source PCM in a recording.
    let observed_end_ns = self.timestamp_ns();
    let timestamp_ns = self
      .timestamp_clock
      .lock()
      .map(|mut clock| clock.place(observed_end_ns, frame_count, sample_rate))
      .unwrap_or(observed_end_ns);
    let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
    let Ok(mut subscribers) = self.subscribers.lock() else {
      return;
    };
    subscribers.retain(|subscriber| {
      let Some(subscriber) = subscriber.upgrade() else {
        return false;
      };
      if !subscriber.active.load(Ordering::Acquire) {
        return false;
      }
      let Some(mut copy) = subscriber.pool.pop() else {
        subscriber.dropped.fetch_add(1, Ordering::Relaxed);
        return true;
      };
      copy.clear();
      if copy.capacity() < samples.len() {
        copy.reserve_exact(samples.len());
      }
      copy.extend_from_slice(samples);
      let frame = PcmFrame {
        samples: copy,
        channels,
        sample_rate,
        timestamp_ns,
        sequence,
        dropped_before: subscriber.dropped.swap(0, Ordering::Relaxed),
        channel_layout,
      };
      if let Err(frame) = subscriber.queue.push(frame) {
        subscriber.dropped.fetch_add(1, Ordering::Relaxed);
        let mut copy = frame.samples;
        copy.clear();
        let _ = subscriber.pool.push(copy);
      }
      true
    });
  }
}

/// The consumer-owned half of a measured PCM subscription.
pub struct MeasuredPcmReceiver {
  inner: Arc<MeasuredPcmSubscriber>,
}

impl MeasuredPcmReceiver {
  pub fn try_recv(&self) -> Option<PcmFrame> {
    self.inner.queue.pop()
  }

  pub fn recv_timeout(&self, timeout: Duration) -> Option<PcmFrame> {
    let deadline = Instant::now() + timeout;
    loop {
      if let Some(frame) = self.try_recv() {
        return Some(frame);
      }
      if Instant::now() >= deadline || !self.inner.active.load(Ordering::Acquire) {
        return None;
      }
      std::thread::sleep(Duration::from_millis(1));
    }
  }

  pub fn recycle(&self, mut frame: PcmFrame) {
    frame.samples.clear();
    let _ = self.inner.pool.push(frame.samples);
  }

  pub fn dropped_chunks(&self) -> u64 {
    self.inner.dropped.load(Ordering::Relaxed)
  }
}

impl Drop for MeasuredPcmReceiver {
  fn drop(&mut self) {
    self.inner.active.store(false, Ordering::Release);
    while let Some(mut frame) = self.inner.queue.pop() {
      frame.samples.clear();
      let _ = self.inner.pool.push(frame.samples);
    }
  }
}

/// One active capture session; removing it from `AppState` and dropping it stops the stream.
pub trait AudioCaptureSession: Send {
  fn request_clear_peak_history(&self);
  fn request_reset_true_peak_max(&self);
}

/// List devices + start capture; returns a session as a trait object to avoid circular deps between `capture` and concrete backends.
pub trait AudioCapture: Send + Sync {
  fn list_devices(&self) -> Result<Vec<DeviceInfo>, String>;

  #[allow(clippy::too_many_arguments)]
  fn start_session(
    &self,
    device_id: &str,
    frame_subscribers: FrameSubscribers,
    app: AppHandle,
    channel_layout: std::sync::Arc<std::sync::Mutex<ChannelLayoutSetting>>,
    loudness_weights: std::sync::Arc<std::sync::Mutex<Option<Vec<f64>>>>,
    dialogue_gating: std::sync::Arc<std::sync::Mutex<bool>>,
    dialogue_vad_engine: std::sync::Arc<std::sync::Mutex<VadEngineKind>>,
    measured_pcm: Arc<MeasuredPcmSubscriptions>,
  ) -> Result<Box<dyn AudioCaptureSession>, String>;
}

#[cfg(test)]
mod measured_pcm_tests {
  use super::{MeasuredPcmSubscriptions, PcmTimestampClock};
  use crate::engine::ChannelLayoutSetting;

  #[test]
  fn subscriber_receives_source_pcm_with_metadata_and_recycles_buffers() {
    let hub = MeasuredPcmSubscriptions::default();
    let receiver = hub.subscribe(2).expect("subscriber");
    hub.publish(&[0.25, -0.5], 48_000, 2, ChannelLayoutSetting::Stereo);

    let first = receiver.try_recv().expect("frame");
    assert_eq!(first.samples, vec![0.25, -0.5]);
    assert_eq!(first.sample_rate, 48_000);
    assert_eq!(first.channels, 2);
    assert_eq!(first.sequence, 0);
    assert_eq!(first.dropped_before, 0);
    assert_eq!(first.channel_layout, ChannelLayoutSetting::Stereo);
    receiver.recycle(first);

    hub.publish(&[0.75], 44_100, 1, ChannelLayoutSetting::Auto);
    let second = receiver.try_recv().expect("recycled frame");
    assert_eq!(second.samples, vec![0.75]);
    assert_eq!(second.sequence, 1);
  }

  #[test]
  fn sample_clock_smooths_callback_jitter_but_preserves_real_gaps_and_rate_changes() {
    let mut clock = PcmTimestampClock::default();
    assert_eq!(clock.place(1_000_000, 48, 48_000), 0);
    assert_eq!(clock.place(2_400_000, 48, 48_000), 1_000_000);
    assert_eq!(clock.place(3_600_000, 48, 48_000), 2_000_000);
    assert_eq!(clock.place(104_600_000, 48, 48_000), 103_600_000);
    assert_eq!(clock.place(105_600_000, 44, 44_100), 104_602_268);
  }

  #[test]
  fn warmed_worker_publish_reuses_the_subscriber_buffer_without_allocating() {
    let hub = MeasuredPcmSubscriptions::default();
    let receiver = hub.subscribe(1).expect("subscriber");
    for _ in 0..2 {
      hub.publish(&[0.0, 0.0], 48_000, 2, ChannelLayoutSetting::Stereo);
      receiver.recycle(receiver.try_recv().expect("warmup frame"));
    }

    let allocations =
      crate::dsp::shared_spectral_engine::allocation_counter::count_current_thread_allocations(
        || hub.publish(&[0.25, -0.5], 48_000, 2, ChannelLayoutSetting::Stereo),
      );

    assert_eq!(allocations, 0, "warmed worker publish allocated");
  }

  #[test]
  fn slow_subscriber_drops_only_its_own_input() {
    let hub = MeasuredPcmSubscriptions::default();
    let slow = hub.subscribe(1).expect("slow subscriber");
    let healthy = hub.subscribe(2).expect("healthy subscriber");

    hub.publish(&[1.0], 48_000, 1, ChannelLayoutSetting::Auto);
    let healthy_first = healthy.try_recv().expect("healthy first");
    healthy.recycle(healthy_first);
    hub.publish(&[2.0], 48_000, 1, ChannelLayoutSetting::Auto);

    let slow_first = slow.try_recv().expect("slow first");
    assert_eq!(slow_first.samples, vec![1.0]);
    slow.recycle(slow_first);
    hub.publish(&[3.0], 48_000, 1, ChannelLayoutSetting::Auto);
    let slow_after_drop = slow.try_recv().expect("slow resumes");
    assert_eq!(slow_after_drop.samples, vec![3.0]);
    assert_eq!(slow_after_drop.dropped_before, 1);

    let healthy_second = healthy.try_recv().expect("healthy second");
    assert_eq!(healthy_second.samples, vec![2.0]);
    healthy.recycle(healthy_second);
    let healthy_third = healthy.try_recv().expect("healthy third");
    assert_eq!(healthy_third.samples, vec![3.0]);
    assert_eq!(healthy_third.dropped_before, 0);
  }

  #[test]
  fn dropping_receiver_detaches_without_affecting_other_subscribers() {
    let hub = MeasuredPcmSubscriptions::default();
    let detached = hub.subscribe(1).expect("detached subscriber");
    let retained = hub.subscribe(1).expect("retained subscriber");
    drop(detached);

    hub.publish(&[0.5], 48_000, 1, ChannelLayoutSetting::Auto);
    assert_eq!(
      retained.try_recv().expect("retained frame").samples,
      vec![0.5]
    );
  }
}
