use serde::Serialize;

use crate::audio::PcmFrame;
use crate::engine::ChannelLayoutSetting;

pub const OUTPUT_SAMPLE_RATE: u32 = 48_000;
pub const OUTPUT_CHANNELS: u16 = 2;
pub const AAC_BITRATE: u32 = 192_000;
pub const MAX_AUDIO_INTERRUPTIONS: usize = 32;
const MAX_PACKET_FRAMES: u64 = 1_024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SilenceReason {
  LiveStopped,
  LiveRestart,
  SourceModeFile,
  AudioBackpressure,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioInterruption {
  pub reason: SilenceReason,
  pub started_ms: u64,
  pub duration_ms: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AudioPacket {
  pub start_frame: u64,
  pub samples: Vec<i16>,
}

impl AudioPacket {
  pub fn frame_count(&self) -> u64 {
    (self.samples.len() / usize::from(OUTPUT_CHANNELS)) as u64
  }
}

/// Builds one fixed-rate stereo timeline. Incoming PCM timestamps place source buffers on the
/// video clock; gaps are made explicit as silence packets instead of stretching neighboring PCM.
pub struct AudioTimeline {
  origin_ns: u64,
  next_frame: u64,
  resample_remainder: u64,
  resample_rate: u32,
  silent_frames: u64,
  interruptions: Vec<AudioInterruption>,
}

impl AudioTimeline {
  pub fn new(origin_ns: u64) -> Self {
    Self {
      origin_ns,
      next_frame: 0,
      resample_remainder: 0,
      resample_rate: 0,
      silent_frames: 0,
      interruptions: Vec::new(),
    }
  }

  pub fn ingest(&mut self, frame: &PcmFrame, fallback_reason: SilenceReason) -> Vec<AudioPacket> {
    let mut packets = Vec::new();
    let target_frame = ns_to_output_frame(frame.timestamp_ns.saturating_sub(self.origin_ns));
    if target_frame > self.next_frame {
      let reason = if frame.dropped_before > 0 {
        SilenceReason::AudioBackpressure
      } else {
        fallback_reason
      };
      packets.extend(self.insert_silence_to(target_frame, reason));
    }

    let mut stereo = self.resample_and_downmix(frame);
    let overlap = self.next_frame.saturating_sub(target_frame);
    if overlap > 0 {
      let trim_samples = usize::try_from(overlap)
        .unwrap_or(usize::MAX)
        .saturating_mul(usize::from(OUTPUT_CHANNELS))
        .min(stereo.len());
      stereo.drain(..trim_samples);
    }
    if !stereo.is_empty() {
      let packet = AudioPacket {
        start_frame: self.next_frame,
        samples: stereo,
      };
      self.next_frame = self.next_frame.saturating_add(packet.frame_count());
      packets.push(packet);
    }
    packets
  }

  pub fn insert_silence_to(
    &mut self,
    target_frame: u64,
    reason: SilenceReason,
  ) -> Vec<AudioPacket> {
    let missing = target_frame.saturating_sub(self.next_frame);
    if missing == 0 {
      return Vec::new();
    }
    self.record_interruption(self.next_frame, missing, reason);
    self.silent_frames = self.silent_frames.saturating_add(missing);
    let mut packets = Vec::new();
    let mut remaining = missing;
    while remaining > 0 {
      let frames = remaining.min(MAX_PACKET_FRAMES);
      packets.push(AudioPacket {
        start_frame: self.next_frame,
        samples: vec![0; frames as usize * usize::from(OUTPUT_CHANNELS)],
      });
      self.next_frame = self.next_frame.saturating_add(frames);
      remaining -= frames;
    }
    self.next_frame = target_frame;
    packets
  }

  pub fn silent_duration_ms(&self) -> u64 {
    frames_to_ms(self.silent_frames)
  }

  pub fn interruptions(&self) -> &[AudioInterruption] {
    &self.interruptions
  }

  pub fn origin_ns(&self) -> u64 {
    self.origin_ns
  }

  pub fn record_output_drop(&mut self, start_frame: u64, frames: u64) {
    if frames == 0 {
      return;
    }
    self.record_interruption(start_frame, frames, SilenceReason::AudioBackpressure);
    self.silent_frames = self.silent_frames.saturating_add(frames);
  }

  fn resample_and_downmix(&mut self, frame: &PcmFrame) -> Vec<i16> {
    let channels = usize::from(frame.channels.max(1));
    let input_frames = frame.samples.len() / channels;
    if input_frames == 0 || frame.sample_rate == 0 {
      return Vec::new();
    }
    if self.resample_rate != frame.sample_rate {
      self.resample_rate = frame.sample_rate;
      self.resample_remainder = 0;
    }
    let numerator = (input_frames as u64)
      .saturating_mul(u64::from(OUTPUT_SAMPLE_RATE))
      .saturating_add(self.resample_remainder);
    let output_frames = numerator / u64::from(frame.sample_rate);
    self.resample_remainder = numerator % u64::from(frame.sample_rate);
    let mut output = Vec::with_capacity(
      usize::try_from(output_frames)
        .unwrap_or(0)
        .saturating_mul(usize::from(OUTPUT_CHANNELS)),
    );
    for output_index in 0..output_frames {
      let source_position =
        output_index as f64 * f64::from(frame.sample_rate) / f64::from(OUTPUT_SAMPLE_RATE);
      let first = (source_position.floor() as usize).min(input_frames - 1);
      let second = (first + 1).min(input_frames - 1);
      let fraction = source_position - first as f64;
      let (first_left, first_right) = downmix_frame(
        &frame.samples[first * channels..(first + 1) * channels],
        frame.channel_layout,
      );
      let (second_left, second_right) = downmix_frame(
        &frame.samples[second * channels..(second + 1) * channels],
        frame.channel_layout,
      );
      output.push(to_i16(
        first_left + (second_left - first_left) * fraction as f32,
      ));
      output.push(to_i16(
        first_right + (second_right - first_right) * fraction as f32,
      ));
    }
    output
  }

  fn record_interruption(&mut self, start_frame: u64, frames: u64, reason: SilenceReason) {
    let started_ms = frames_to_ms(start_frame);
    let duration_ms = frames_to_ms(frames);
    if let Some(last) = self.interruptions.last_mut() {
      if last.reason == reason && last.started_ms.saturating_add(last.duration_ms) == started_ms {
        last.duration_ms = last.duration_ms.saturating_add(duration_ms);
        return;
      }
    }
    if self.interruptions.len() == MAX_AUDIO_INTERRUPTIONS {
      self.interruptions.remove(0);
    }
    self.interruptions.push(AudioInterruption {
      reason,
      started_ms,
      duration_ms,
    });
  }
}

fn ns_to_output_frame(timestamp_ns: u64) -> u64 {
  timestamp_ns.saturating_mul(u64::from(OUTPUT_SAMPLE_RATE)) / 1_000_000_000
}

fn frames_to_ms(frames: u64) -> u64 {
  frames.saturating_mul(1_000) / u64::from(OUTPUT_SAMPLE_RATE)
}

fn effective_layout(layout: ChannelLayoutSetting, channels: usize) -> ChannelLayoutSetting {
  match (layout, channels) {
    (ChannelLayoutSetting::Auto, 6) => ChannelLayoutSetting::Surround51,
    (ChannelLayoutSetting::Auto, 8) => ChannelLayoutSetting::Surround71,
    (other, _) => other,
  }
}

fn downmix_frame(samples: &[f32], layout: ChannelLayoutSetting) -> (f32, f32) {
  match samples.len() {
    0 => (0.0, 0.0),
    1 => (samples[0], samples[0]),
    _ => match effective_layout(layout, samples.len()) {
      ChannelLayoutSetting::Surround51 if samples.len() >= 6 => (
        samples[0]
          + samples[2] * std::f32::consts::FRAC_1_SQRT_2
          + samples[4] * std::f32::consts::FRAC_1_SQRT_2,
        samples[1]
          + samples[2] * std::f32::consts::FRAC_1_SQRT_2
          + samples[5] * std::f32::consts::FRAC_1_SQRT_2,
      ),
      ChannelLayoutSetting::Surround71 if samples.len() >= 8 => (
        samples[0] + samples[2] * std::f32::consts::FRAC_1_SQRT_2 + (samples[4] + samples[6]) * 0.5,
        samples[1] + samples[2] * std::f32::consts::FRAC_1_SQRT_2 + (samples[5] + samples[7]) * 0.5,
      ),
      _ => (samples[0], samples[1]),
    },
  }
}

fn to_i16(sample: f32) -> i16 {
  (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16
}

#[cfg(test)]
mod tests {
  use super::*;

  fn frame(samples: Vec<f32>, channels: u16, rate: u32, timestamp_ns: u64) -> PcmFrame {
    PcmFrame {
      samples,
      channels,
      sample_rate: rate,
      timestamp_ns,
      sequence: 0,
      dropped_before: 0,
      channel_layout: ChannelLayoutSetting::Auto,
    }
  }

  #[test]
  fn duplicates_mono_and_resamples_to_48_khz() {
    let mut timeline = AudioTimeline::new(0);
    let packets = timeline.ingest(
      &frame(vec![0.25; 441], 1, 44_100, 0),
      SilenceReason::LiveStopped,
    );
    assert_eq!(packets.len(), 1);
    assert_eq!(packets[0].frame_count(), 480);
    assert!(packets[0]
      .samples
      .as_chunks::<2>()
      .0
      .iter()
      .all(|pair| pair[0] == pair[1]));
  }

  #[test]
  fn uses_documented_layout_order_for_multichannel_downmix() {
    let (left_51, right_51) = downmix_frame(
      &[0.1, 0.2, 0.3, 0.9, 0.4, 0.5],
      ChannelLayoutSetting::Surround51,
    );
    assert!(left_51 > 0.59 && left_51 < 0.60);
    assert!(right_51 > 0.76 && right_51 < 0.77);
    let (left_71, right_71) = downmix_frame(
      &[0.1, 0.2, 0.3, 0.9, 0.4, 0.5, 0.6, 0.7],
      ChannelLayoutSetting::Surround71,
    );
    assert!(left_71 > left_51);
    assert!(right_71 > right_51);
  }

  #[test]
  fn timestamps_insert_silence_and_backpressure_has_its_own_reason() {
    let mut timeline = AudioTimeline::new(1_000_000_000);
    let mut delayed = frame(vec![0.5; 960], 2, 48_000, 1_020_000_000);
    delayed.dropped_before = 2;
    let packets = timeline.ingest(&delayed, SilenceReason::LiveRestart);
    assert_eq!(packets[0].frame_count(), 960);
    assert!(packets[0].samples.iter().all(|sample| *sample == 0));
    assert_eq!(timeline.silent_duration_ms(), 20);
    assert_eq!(
      timeline.interruptions()[0].reason,
      SilenceReason::AudioBackpressure
    );
  }

  #[test]
  fn overlapping_input_is_trimmed_to_preserve_monotonic_timestamps() {
    let mut timeline = AudioTimeline::new(0);
    let first = frame(vec![0.25; 960], 2, 48_000, 0);
    assert_eq!(
      timeline.ingest(&first, SilenceReason::LiveStopped)[0].frame_count(),
      480
    );
    let overlap = frame(vec![0.5; 960], 2, 48_000, 5_000_000);
    let packets = timeline.ingest(&overlap, SilenceReason::LiveStopped);
    assert_eq!(packets[0].start_frame, 480);
    assert_eq!(packets[0].frame_count(), 240);
  }

  #[test]
  fn repeated_44k1_chunks_do_not_accumulate_av_clock_drift() {
    let mut timeline = AudioTimeline::new(0);
    for index in 0..1_000_u64 {
      let source = frame(vec![0.1; 441 * 2], 2, 44_100, index * 10_000_000);
      timeline.ingest(&source, SilenceReason::LiveRestart);
    }
    assert_eq!(timeline.next_frame, 480_000);
    assert_eq!(timeline.silent_duration_ms(), 0);
  }

  #[test]
  fn sample_rate_change_resets_resampler_without_moving_the_video_clock() {
    let mut timeline = AudioTimeline::new(0);
    let first = frame(vec![0.1; 441], 1, 44_100, 0);
    let second = frame(vec![0.1; 480], 1, 48_000, 10_000_000);
    timeline.ingest(&first, SilenceReason::LiveRestart);
    timeline.ingest(&second, SilenceReason::LiveRestart);
    assert_eq!(timeline.next_frame, 960);
    assert_eq!(timeline.silent_duration_ms(), 0);
  }

  #[test]
  fn live_file_live_gaps_keep_distinct_reasons() {
    let mut timeline = AudioTimeline::new(0);
    timeline.insert_silence_to(480, SilenceReason::LiveStopped);
    timeline.insert_silence_to(960, SilenceReason::SourceModeFile);
    timeline.insert_silence_to(1_440, SilenceReason::LiveRestart);
    assert_eq!(timeline.silent_duration_ms(), 30);
    assert_eq!(
      timeline
        .interruptions()
        .iter()
        .map(|interruption| interruption.reason)
        .collect::<Vec<_>>(),
      vec![
        SilenceReason::LiveStopped,
        SilenceReason::SourceModeFile,
        SilenceReason::LiveRestart
      ]
    );
  }

  #[test]
  fn interruption_history_is_bounded_and_adjacent_reasons_merge() {
    let mut timeline = AudioTimeline::new(0);
    for index in 1..=(MAX_AUDIO_INTERRUPTIONS as u64 + 5) {
      let reason = if index.is_multiple_of(2) {
        SilenceReason::LiveStopped
      } else {
        SilenceReason::LiveRestart
      };
      timeline.insert_silence_to(index * 48, reason);
    }
    assert_eq!(timeline.interruptions().len(), MAX_AUDIO_INTERRUPTIONS);
    timeline.insert_silence_to(
      (MAX_AUDIO_INTERRUPTIONS as u64 + 7) * 48,
      SilenceReason::LiveStopped,
    );
    timeline.insert_silence_to(
      (MAX_AUDIO_INTERRUPTIONS as u64 + 8) * 48,
      SilenceReason::LiveStopped,
    );
    assert_eq!(timeline.interruptions().last().unwrap().duration_ms, 3);
  }

  #[test]
  fn native_output_backpressure_is_accounted_as_silence() {
    let mut timeline = AudioTimeline::new(0);
    timeline.record_output_drop(480, 480);
    assert_eq!(timeline.silent_duration_ms(), 10);
    assert_eq!(
      timeline.interruptions(),
      &[AudioInterruption {
        reason: SilenceReason::AudioBackpressure,
        started_ms: 10,
        duration_ms: 10,
      }]
    );
  }
}
