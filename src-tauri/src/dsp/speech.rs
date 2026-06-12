//! Speech-activity sidechain for dialogue-gated loudness.
//!
//! Downmixes the input to mono, resamples to 16 kHz, runs the Silero VAD over fixed
//! 512-sample chunks, and reports a per-100ms-block speech decision by majority vote.

use rubato::{
  Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use voice_activity_detector::VoiceActivityDetector;

/// Silero operates at 16 kHz over fixed 512-sample (32 ms) chunks.
const VAD_RATE: usize = 16_000;
const VAD_CHUNK: usize = 512;
/// Mono input frames fed to the resampler per call (must be fixed for `SincFixedIn`).
const RESAMPLER_IN_CHUNK: usize = 1024;
/// Speech probability at/above which a chunk counts as speech.
const SPEECH_THRESHOLD: f32 = 0.5;

/// Average all channels of an interleaved frame buffer into a mono signal.
pub fn downmix_to_mono(interleaved: &[f32], channels: u16) -> Vec<f32> {
  let ch = channels.max(1) as usize;
  if ch == 1 {
    return interleaved.to_vec();
  }
  let frames = interleaved.len() / ch;
  let mut mono = Vec::with_capacity(frames);
  for f in 0..frames {
    let base = f * ch;
    let sum: f32 = interleaved[base..base + ch].iter().sum();
    mono.push(sum / ch as f32);
  }
  mono
}

/// Accumulates per-chunk speech decisions within one 100ms loudness block and reports
/// the majority verdict for that block.
pub struct BlockVote {
  speech: usize,
  total: usize,
}

impl BlockVote {
  pub fn new() -> Self {
    Self {
      speech: 0,
      total: 0,
    }
  }

  /// Record one VAD chunk's speech/non-speech decision.
  pub fn record(&mut self, is_speech: bool) {
    self.total += 1;
    if is_speech {
      self.speech += 1;
    }
  }

  /// True when at least half of the recorded chunks were speech (false if none recorded).
  pub fn is_speech_majority(&self) -> bool {
    self.total > 0 && self.speech * 2 >= self.total
  }

  pub fn reset(&mut self) {
    self.speech = 0;
    self.total = 0;
  }
}

/// Streaming speech detector: mono samples in, per-100ms-block speech verdict out.
pub struct SpeechDetector {
  vad: VoiceActivityDetector,
  resampler: SincFixedIn<f32>,
  /// Mono samples at the source rate, accumulating toward `RESAMPLER_IN_CHUNK`.
  in_buf: Vec<f32>,
  /// Resampled 16 kHz samples, accumulating toward `VAD_CHUNK`.
  chunk_buf: Vec<f32>,
  /// Votes for the in-progress 100ms loudness block.
  vote: BlockVote,
}

impl SpeechDetector {
  /// Builds the detector for a given capture sample rate. `None` if the VAD model or the
  /// resampler fails to initialise (caller then disables dialogue gating gracefully).
  pub fn new(source_rate: f64) -> Option<Self> {
    let vad = VoiceActivityDetector::builder()
      .sample_rate(VAD_RATE as i64)
      .chunk_size(VAD_CHUNK)
      .build()
      .ok()?;
    let resampler = Self::build_resampler(source_rate)?;
    Some(Self {
      vad,
      resampler,
      in_buf: Vec::new(),
      chunk_buf: Vec::new(),
      vote: BlockVote::new(),
    })
  }

  fn build_resampler(source_rate: f64) -> Option<SincFixedIn<f32>> {
    let params = SincInterpolationParameters {
      sinc_len: 128,
      f_cutoff: 0.95,
      oversampling_factor: 128,
      interpolation: SincInterpolationType::Linear,
      window: WindowFunction::BlackmanHarris2,
    };
    SincFixedIn::<f32>::new(
      VAD_RATE as f64 / source_rate,
      1.0,
      params,
      RESAMPLER_IN_CHUNK,
      1,
    )
    .ok()
  }

  /// Feed mono samples (source rate). Resamples to 16 kHz, runs the VAD over completed
  /// 512-sample chunks, and records each chunk's speech decision into the current block.
  pub fn push_mono(&mut self, mono: &[f32]) {
    self.in_buf.extend_from_slice(mono);
    while self.in_buf.len() >= RESAMPLER_IN_CHUNK {
      let block: Vec<f32> = self.in_buf.drain(..RESAMPLER_IN_CHUNK).collect();
      if let Ok(out) = self.resampler.process(&[block], None) {
        self.chunk_buf.extend_from_slice(&out[0]);
      }
      while self.chunk_buf.len() >= VAD_CHUNK {
        let chunk: Vec<f32> = self.chunk_buf.drain(..VAD_CHUNK).collect();
        let probability = self.vad.predict(chunk);
        self.vote.record(probability >= SPEECH_THRESHOLD);
      }
    }
  }

  /// Majority verdict for the block since the last call, then clears the block's votes.
  pub fn take_block_decision(&mut self) -> bool {
    let decision = self.vote.is_speech_majority();
    self.vote.reset();
    decision
  }

  pub fn reset(&mut self) {
    self.in_buf.clear();
    self.chunk_buf.clear();
    self.vote.reset();
    let _ = self.resampler.reset();
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn downmix_averages_channels_per_frame() {
    // 2 channels, 2 frames: frame0 = [1.0, 0.0], frame1 = [0.0, 1.0]
    let interleaved = [1.0_f32, 0.0, 0.0, 1.0];
    let mono = downmix_to_mono(&interleaved, 2);
    assert_eq!(mono, vec![0.5, 0.5]);
  }

  #[test]
  fn vote_is_speech_when_at_least_half_chunks_are_speech() {
    let mut v = BlockVote::new();
    v.record(true);
    v.record(true);
    v.record(false);
    assert!(
      v.is_speech_majority(),
      "2 of 3 speech chunks should be a majority"
    );
  }

  #[test]
  fn vote_is_not_speech_when_minority_chunks_are_speech() {
    let mut v = BlockVote::new();
    v.record(true);
    v.record(false);
    v.record(false);
    assert!(
      !v.is_speech_majority(),
      "1 of 3 speech chunks should not be a majority"
    );
  }

  #[test]
  fn vote_with_no_chunks_is_not_speech() {
    let v = BlockVote::new();
    assert!(!v.is_speech_majority());
  }

  // Integration smoke test: exercises the full mono→resample→Silero→vote chain on real
  // audio. Pure silence must come out as non-speech. The positive (speech→true) path needs
  // a real recording and is covered by manual verification per the design spec.
  #[test]
  fn silence_is_not_classified_as_speech() {
    let mut d = SpeechDetector::new(48_000.0).expect("detector builds from bundled model");
    let silence = vec![0.0_f32; 48_000]; // 1s of silence at 48 kHz
    d.push_mono(&silence);
    assert!(
      !d.take_block_decision(),
      "pure silence must not be classified as speech"
    );
  }
}
