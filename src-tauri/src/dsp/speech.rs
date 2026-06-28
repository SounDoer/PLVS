//! Speech-activity sidechain for dialogue-gated loudness.
//!
//! Downmixes the input to mono, resamples to 16 kHz, runs the Silero VAD over fixed
//! 512-sample chunks, and reports a per-100ms-block speech decision by majority vote.

use firered_vad::Vad as FireRedVad;
use rubato::{
  Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use voice_activity_detector::VoiceActivityDetector;

/// All supported VAD engines consume mono 16 kHz audio; source audio is resampled once
/// before engine-specific frame splitting.
const VAD_RATE: usize = 16_000;
/// Silero operates at 16 kHz over fixed 512-sample (32 ms) chunks.
const VAD_CHUNK: usize = 512;
/// Mono input frames fed to the resampler per call (must be fixed for `SincFixedIn`).
const RESAMPLER_IN_CHUNK: usize = 1024;
/// Speech probability at/above which a chunk counts as speech.
const SPEECH_THRESHOLD: f32 = 0.5;

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VadEngineKind {
  Silero,
  FireRed,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VadDecision {
  pub active: bool,
  pub voice_probability: Option<f32>,
  pub speech_probability: Option<f32>,
  pub singing_probability: Option<f32>,
  pub music_probability: Option<f32>,
}

impl VadDecision {
  fn speech(probability: f32) -> Self {
    Self {
      active: probability >= SPEECH_THRESHOLD,
      voice_probability: Some(probability),
      speech_probability: Some(probability),
      singing_probability: None,
      music_probability: None,
    }
  }
}

#[allow(dead_code)]
pub trait DialogueVadEngine: Send {
  fn kind(&self) -> VadEngineKind;
  fn frame_size(&self) -> usize;
  fn predict(&mut self, frame: Vec<f32>) -> Option<VadDecision>;
  fn reset(&mut self);
}

struct SileroVadEngine {
  vad: VoiceActivityDetector,
}

impl SileroVadEngine {
  fn new() -> Option<Self> {
    let vad = VoiceActivityDetector::builder()
      .sample_rate(VAD_RATE as i64)
      .chunk_size(VAD_CHUNK)
      .build()
      .ok()?;
    Some(Self { vad })
  }
}

impl DialogueVadEngine for SileroVadEngine {
  fn kind(&self) -> VadEngineKind {
    VadEngineKind::Silero
  }

  fn frame_size(&self) -> usize {
    VAD_CHUNK
  }

  fn predict(&mut self, frame: Vec<f32>) -> Option<VadDecision> {
    Some(VadDecision::speech(self.vad.predict(frame)))
  }

  fn reset(&mut self) {
    self.vad.reset();
  }
}

struct FireRedVadEngine {
  vad: FireRedVad,
}

impl FireRedVadEngine {
  fn new() -> Option<Self> {
    let vad = FireRedVad::bundled().ok()?;
    Some(Self { vad })
  }
}

impl DialogueVadEngine for FireRedVadEngine {
  fn kind(&self) -> VadEngineKind {
    VadEngineKind::FireRed
  }

  fn frame_size(&self) -> usize {
    firered_vad::FrameResult::FRAME_SHIFT_SAMPLES as usize
  }

  fn predict(&mut self, frame: Vec<f32>) -> Option<VadDecision> {
    self.vad.push_samples(&frame).ok()?;
    let frame = self.vad.recent_frames().last()?;
    Some(VadDecision {
      active: frame.is_speech(),
      voice_probability: Some(frame.smoothed_prob()),
      speech_probability: Some(frame.smoothed_prob()),
      singing_probability: None,
      music_probability: None,
    })
  }

  fn reset(&mut self) {
    self.vad.reset();
  }
}

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

  /// Record one VAD frame's speech/non-speech decision.
  pub fn record(&mut self, decision: VadDecision) {
    self.total += 1;
    if decision.active {
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
  engine: Box<dyn DialogueVadEngine>,
  resampler: SincFixedIn<f32>,
  /// Mono samples at the source rate, accumulating toward `RESAMPLER_IN_CHUNK`.
  in_buf: Vec<f32>,
  /// Resampled 16 kHz samples, accumulating toward the current engine's frame size.
  chunk_buf: Vec<f32>,
  /// Votes for the in-progress 100ms loudness block.
  vote: BlockVote,
}

impl SpeechDetector {
  /// Builds the detector for a given capture sample rate. `None` if the VAD model or the
  /// resampler fails to initialise (caller then disables dialogue gating gracefully).
  pub fn new(source_rate: f64) -> Option<Self> {
    Self::new_with_engine(source_rate, VadEngineKind::Silero)
  }

  pub fn new_with_engine(source_rate: f64, kind: VadEngineKind) -> Option<Self> {
    let engine: Box<dyn DialogueVadEngine> = match kind {
      VadEngineKind::Silero => Box::new(SileroVadEngine::new()?),
      VadEngineKind::FireRed => Box::new(FireRedVadEngine::new()?),
    };
    let resampler = Self::build_resampler(source_rate)?;
    Some(Self {
      engine,
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

  /// Feed mono samples (source rate). Resamples to 16 kHz, runs the selected VAD over completed
  /// engine-sized frames, and records each frame's speech decision into the current block.
  pub fn push_mono(&mut self, mono: &[f32]) {
    self.in_buf.extend_from_slice(mono);
    while self.in_buf.len() >= RESAMPLER_IN_CHUNK {
      let block: Vec<f32> = self.in_buf.drain(..RESAMPLER_IN_CHUNK).collect();
      if let Ok(out) = self.resampler.process(&[block], None) {
        self.chunk_buf.extend_from_slice(&out[0]);
      }
      let frame_size = self.engine.frame_size();
      while self.chunk_buf.len() >= frame_size {
        let chunk: Vec<f32> = self.chunk_buf.drain(..frame_size).collect();
        if let Some(decision) = self.engine.predict(chunk) {
          self.vote.record(decision);
        }
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
    self.resampler.reset();
    self.engine.reset();
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
    v.record(VadDecision {
      active: true,
      ..VadDecision::default()
    });
    v.record(VadDecision {
      active: true,
      ..VadDecision::default()
    });
    v.record(VadDecision {
      active: false,
      ..VadDecision::default()
    });
    assert!(
      v.is_speech_majority(),
      "2 of 3 speech chunks should be a majority"
    );
  }

  #[test]
  fn vote_is_not_speech_when_minority_chunks_are_speech() {
    let mut v = BlockVote::new();
    v.record(VadDecision {
      active: true,
      ..VadDecision::default()
    });
    v.record(VadDecision {
      active: false,
      ..VadDecision::default()
    });
    v.record(VadDecision {
      active: false,
      ..VadDecision::default()
    });
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

  #[test]
  fn silero_engine_reports_expected_frame_size() {
    let d = SpeechDetector::new_with_engine(48_000.0, VadEngineKind::Silero)
      .expect("silero detector builds from bundled model");
    assert_eq!(d.engine.kind(), VadEngineKind::Silero);
    assert_eq!(d.engine.frame_size(), VAD_CHUNK);
  }

  #[test]
  fn firered_engine_reports_expected_frame_size() {
    let d = SpeechDetector::new_with_engine(48_000.0, VadEngineKind::FireRed)
      .expect("firered detector builds from bundled model");
    assert_eq!(d.engine.kind(), VadEngineKind::FireRed);
    assert_eq!(
      d.engine.frame_size(),
      firered_vad::FrameResult::FRAME_SHIFT_SAMPLES as usize
    );
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

  #[test]
  fn firered_silence_is_not_classified_as_speech() {
    let mut d = SpeechDetector::new_with_engine(48_000.0, VadEngineKind::FireRed)
      .expect("firered detector builds from bundled model");
    let silence = vec![0.0_f32; 48_000]; // 1s of silence at 48 kHz
    d.push_mono(&silence);
    assert!(
      !d.take_block_decision(),
      "pure silence must not be classified as speech by FireRed"
    );
  }
}
