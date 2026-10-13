//! Speech-activity sidechain for dialogue-gated loudness.
//!
//! Resamples detector inputs to 16 kHz, normalizes engine-native evidence to 100 ms blocks, and
//! fuses per-channel decisions without arithmetic downmix cancellation.

use firered_vad::Vad as FireRedVad;
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{
  Async, FixedAsync, Resampler, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use voice_activity_detector::VoiceActivityDetector;

use crate::vad::{VadBlockAggregator, VadBlockEvidence, VadDecision};

/// All supported VAD engines consume mono 16 kHz audio; source audio is resampled once
/// before engine-specific frame splitting.
const VAD_RATE: usize = 16_000;
/// Silero operates at 16 kHz over fixed 512-sample (32 ms) chunks.
const VAD_CHUNK: usize = 512;
/// Dialogue decisions share the same 100 ms clock as the BS.1770 energy blocks. The resampler
/// therefore consumes one complete source-rate loudness block per call instead of an unrelated
/// fixed chunk that could strand source samples on the wrong side of a block boundary.
const DIALOGUE_BLOCK_SECONDS: f64 = 0.1;
/// Speech probability at/above which a chunk counts as speech.
const SPEECH_THRESHOLD: f32 = 0.5;

/// Versioned identity written into reports whenever the dialogue sidechain is enabled.
pub const MULTICHANNEL_FUSION_POLICY: &str = "center-priority-fallback-v1";
/// A non-centre channel may override an inactive centre only when it carries materially more
/// energy. This keeps a routed centre authoritative while still supporting off-centre dialogue.
const CENTER_FALLBACK_ENERGY_RATIO: f64 = 2.0;

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum VadEngineKind {
  Silero,
  #[default]
  FireRed,
}

impl VadEngineKind {
  pub fn from_key(key: &str) -> Option<Self> {
    match key {
      "silero" => Some(Self::Silero),
      "firered" => Some(Self::FireRed),
      _ => None,
    }
  }

  pub fn as_key(self) -> &'static str {
    match self {
      Self::Silero => "silero",
      Self::FireRed => "firered",
    }
  }
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
  fn predict(&mut self, frame: Vec<f32>) -> Result<Option<VadDecision>, ()>;
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
      .context_size(64)
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

  fn predict(&mut self, frame: Vec<f32>) -> Result<Option<VadDecision>, ()> {
    Ok(Some(VadDecision::speech(self.vad.predict(frame))))
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

  fn predict(&mut self, frame: Vec<f32>) -> Result<Option<VadDecision>, ()> {
    self.vad.push_samples(&frame).map_err(|_| ())?;
    let Some(frame) = self.vad.recent_frames().last() else {
      return Ok(None);
    };
    Ok(Some(VadDecision {
      active: frame.is_speech(),
      voice_probability: Some(frame.smoothed_prob()),
      speech_probability: Some(frame.smoothed_prob()),
      singing_probability: None,
      music_probability: None,
    }))
  }

  fn reset(&mut self) {
    self.vad.reset();
  }
}

/// Average all channels of an interleaved frame buffer into a mono signal.
#[cfg(test)]
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

/// Streaming speech detector: mono samples in, per-100ms-block speech verdict out.
pub struct SpeechDetector {
  engine: Box<dyn DialogueVadEngine>,
  resampler: Async<f32>,
  /// Source-rate samples in one exact 100 ms dialogue/loudness block.
  resampler_input_frames: usize,
  in_buf: Vec<f32>,
  /// Resampled 16 kHz samples, accumulating toward the current engine's frame size.
  chunk_buf: Vec<f32>,
  /// Aggregates engine frames into the in-progress 100ms loudness block.
  aggregator: VadBlockAggregator,
  failed: bool,
}

impl SpeechDetector {
  /// Builds the detector for a given capture sample rate. `None` if the VAD model or the
  /// resampler fails to initialise (caller then disables dialogue gating gracefully).
  #[allow(dead_code)]
  pub fn new(source_rate: f64) -> Option<Self> {
    Self::new_with_engine(source_rate, VadEngineKind::Silero)
  }

  pub fn new_with_engine(source_rate: f64, kind: VadEngineKind) -> Option<Self> {
    let engine: Box<dyn DialogueVadEngine> = match kind {
      VadEngineKind::Silero => Box::new(SileroVadEngine::new()?),
      VadEngineKind::FireRed => Box::new(FireRedVadEngine::new()?),
    };
    let (resampler, resampler_input_frames) = Self::build_resampler(source_rate)?;
    Some(Self {
      engine,
      resampler,
      resampler_input_frames,
      in_buf: Vec::new(),
      chunk_buf: Vec::new(),
      aggregator: VadBlockAggregator::majority(),
      failed: false,
    })
  }

  fn build_resampler(source_rate: f64) -> Option<(Async<f32>, usize)> {
    let input_frames = (source_rate * DIALOGUE_BLOCK_SECONDS).round() as usize;
    let input_frames = input_frames.max(1);
    let params = SincInterpolationParameters {
      sinc_len: 128,
      f_cutoff: Some(0.95),
      oversampling_factor: 128,
      interpolation: SincInterpolationType::Linear,
      window: WindowFunction::BlackmanHarris2,
    };
    let resampler = Async::<f32>::new_sinc(
      VAD_RATE as f64 / source_rate,
      1.0,
      &params,
      input_frames,
      1,
      FixedAsync::Input,
    )
    .ok()?;
    Some((resampler, input_frames))
  }

  /// Feed mono samples (source rate). Resamples to 16 kHz, runs the selected VAD over completed
  /// engine-sized frames, and records each frame's speech decision into the current block.
  pub fn push_mono(&mut self, mono: &[f32]) {
    if self.failed {
      return;
    }
    self.in_buf.extend_from_slice(mono);
    while self.in_buf.len() >= self.resampler_input_frames {
      let block: Vec<f32> = self.in_buf.drain(..self.resampler_input_frames).collect();
      // rubato 1.0+ takes/returns `audioadapter` buffers instead of `Vec<Vec<f32>>`. Mono, so a
      // single-channel interleaved view over the flat slice on both ends; the output frame count
      // varies per call, so size the scratch to the resampler's max and keep only what it wrote.
      let input = InterleavedSlice::new(&block[..], 1, self.resampler_input_frames).unwrap();
      let max_out = self.resampler.output_frames_max();
      let mut scratch = vec![0.0_f32; max_out];
      let nbr_out = {
        let mut output = InterleavedSlice::new_mut(&mut scratch[..], 1, max_out).unwrap();
        self
          .resampler
          .process_into_buffer(&input, &mut output, None)
          .map(|(_, out_frames)| out_frames)
          .unwrap_or(0)
      };
      self.chunk_buf.extend_from_slice(&scratch[..nbr_out]);
      let frame_size = self.engine.frame_size();
      while self.chunk_buf.len() >= frame_size {
        let chunk: Vec<f32> = self.chunk_buf.drain(..frame_size).collect();
        match self.engine.predict(chunk) {
          Ok(Some(decision)) => self.aggregator.record(decision),
          Ok(None) => {}
          Err(()) => {
            self.failed = true;
            self.aggregator.reset();
            return;
          }
        }
      }
    }
  }

  /// 100ms block verdict since the last call, then clears the block's frame decisions.
  #[allow(dead_code)] // Used by the feature-gated benchmark and focused detector tests.
  pub fn take_block_decision(&mut self) -> Option<bool> {
    self
      .take_block_evidence()
      .ok()
      .flatten()
      .map(|evidence| evidence.active)
  }

  /// Returns normalized evidence, distinguishes detector failure from ordinary not-ready state,
  /// and clears exactly one block. Probabilities remain diagnostic metadata; the engine-specific
  /// adapter has already made the thresholded decision.
  pub fn take_block_evidence(&mut self) -> Result<Option<VadBlockEvidence>, ()> {
    if self.failed {
      Err(())
    } else {
      Ok(self.aggregator.take_evidence())
    }
  }

  pub fn has_failed(&self) -> bool {
    self.failed
  }

  pub fn reset(&mut self) {
    self.in_buf.clear();
    self.chunk_buf.clear();
    self.aggregator.reset();
    self.failed = false;
    self.resampler.reset();
    self.engine.reset();
  }
}

/// Fuse time-aligned per-channel VAD decisions for one loudness block.
///
/// LFE has already been removed by [`MultichannelSpeechDetector`]. With a known centre, centre
/// speech wins directly; off-centre speech is accepted only when the strongest other channel has
/// more than twice the centre energy. Layouts without a centre use an independent-channel maximum.
pub(crate) fn fuse_center_priority(
  decisions: &[Option<bool>],
  energies: &[f64],
  center_position: Option<usize>,
) -> Option<bool> {
  if decisions.is_empty()
    || decisions.len() != energies.len()
    || decisions.iter().any(Option::is_none)
  {
    return None;
  }
  let Some(center) = center_position.filter(|index| *index < decisions.len()) else {
    return Some(decisions.contains(&Some(true)));
  };
  if decisions[center] == Some(true) {
    return Some(true);
  }
  let strongest_other = energies
    .iter()
    .enumerate()
    .filter(|(index, _)| *index != center)
    .map(|(_, energy)| *energy)
    .fold(0.0_f64, f64::max);
  let other_speech = decisions
    .iter()
    .enumerate()
    .any(|(index, decision)| index != center && *decision == Some(true));
  Some(other_speech && strongest_other > energies[center] * CENTER_FALLBACK_ENERGY_RATIO)
}

/// Production multichannel dialogue detector. Every eligible channel keeps an independent VAD
/// state; LFE is excluded before inference, so phase cancellation and LFE dilution cannot hide
/// dialogue. The owner resets this object coherently when the engine or resolved roles change.
pub struct MultichannelSpeechDetector {
  source_channels: usize,
  channel_indices: Vec<usize>,
  detectors: Vec<SpeechDetector>,
  block_energies: Vec<f64>,
  center_position: Option<usize>,
  invalid_input: bool,
}

impl MultichannelSpeechDetector {
  pub fn new(
    source_rate: f64,
    kind: VadEngineKind,
    channels: u16,
    roles: Option<&[String]>,
  ) -> Option<Self> {
    let source_channels = channels.max(1) as usize;
    let roles = roles.filter(|roles| roles.len() == source_channels);
    let channel_indices: Vec<usize> = (0..source_channels)
      .filter(|index| roles.is_none_or(|roles| roles[*index] != "LFE"))
      .collect();
    if channel_indices.is_empty() {
      return None;
    }
    let center_position = roles.and_then(|roles| {
      channel_indices
        .iter()
        .position(|index| roles[*index] == "C")
    });
    let detectors = (0..channel_indices.len())
      .map(|_| SpeechDetector::new_with_engine(source_rate, kind))
      .collect::<Option<Vec<_>>>()?;
    Some(Self {
      source_channels,
      block_energies: vec![0.0; channel_indices.len()],
      channel_indices,
      detectors,
      center_position,
      invalid_input: false,
    })
  }

  pub fn push_interleaved(&mut self, interleaved: &[f32], channels: u16) {
    let channels = channels.max(1) as usize;
    if channels != self.source_channels || !interleaved.len().is_multiple_of(channels) {
      self.invalid_input = true;
      return;
    }
    let frames = interleaved.len() / channels;
    for ((channel_index, detector), energy) in self
      .channel_indices
      .iter()
      .zip(&mut self.detectors)
      .zip(&mut self.block_energies)
    {
      let mut mono = Vec::with_capacity(frames);
      for frame in interleaved.chunks_exact(channels) {
        let sample = frame[*channel_index];
        mono.push(sample);
        *energy += sample as f64 * sample as f64;
      }
      detector.push_mono(&mono);
    }
  }

  pub fn take_block_decision(&mut self) -> Option<bool> {
    if self.invalid_input {
      return None;
    }
    let evidence = self
      .detectors
      .iter_mut()
      .map(SpeechDetector::take_block_evidence)
      .collect::<Result<Vec<_>, _>>()
      .ok()?;
    let decisions: Vec<Option<bool>> = evidence
      .iter()
      .map(|evidence| evidence.map(|evidence| evidence.active))
      .collect();
    let decision = fuse_center_priority(&decisions, &self.block_energies, self.center_position);
    self.block_energies.fill(0.0);
    decision
  }

  pub fn has_failed(&self) -> bool {
    self.invalid_input || self.detectors.iter().any(SpeechDetector::has_failed)
  }

  pub fn reset(&mut self) {
    for detector in &mut self.detectors {
      detector.reset();
    }
    self.block_energies.fill(0.0);
    self.invalid_input = false;
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
  fn fusion_uses_independent_max_without_a_center() {
    assert_eq!(
      fuse_center_priority(&[Some(false), Some(true)], &[1.0, 0.2], None),
      Some(true)
    );
  }

  #[test]
  fn fusion_keeps_center_authoritative_unless_another_channel_is_materially_stronger() {
    assert_eq!(
      fuse_center_priority(
        &[Some(true), Some(false), Some(true)],
        &[0.1, 1.0, 0.1],
        Some(1)
      ),
      Some(false)
    );
    assert_eq!(
      fuse_center_priority(
        &[Some(true), Some(false), Some(false)],
        &[2.01, 1.0, 0.0],
        Some(1)
      ),
      Some(true)
    );
    assert_eq!(
      fuse_center_priority(
        &[Some(false), Some(true), Some(false)],
        &[100.0, 0.01, 100.0],
        Some(1)
      ),
      Some(true)
    );
  }

  #[test]
  fn fusion_waits_for_every_independent_detector() {
    assert_eq!(
      fuse_center_priority(&[Some(true), None], &[1.0, 1.0], None),
      None
    );
  }

  #[test]
  fn multichannel_detector_excludes_lfe_and_finds_center() {
    let roles = ["L", "R", "C", "LFE", "Ls", "Rs"].map(str::to_string);
    let detector =
      MultichannelSpeechDetector::new(48_000.0, VadEngineKind::Silero, 6, Some(&roles))
        .expect("detector builds");
    assert_eq!(detector.channel_indices, vec![0, 1, 2, 4, 5]);
    assert_eq!(detector.center_position, Some(2));
  }

  #[test]
  fn multichannel_detector_rejects_an_lfe_only_selection() {
    let roles = ["LFE".to_string()];
    assert!(
      MultichannelSpeechDetector::new(48_000.0, VadEngineKind::Silero, 1, Some(&roles)).is_none()
    );
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

  #[test]
  fn resampler_intake_is_one_exact_loudness_block_at_common_rates() {
    let d48 =
      SpeechDetector::new_with_engine(48_000.0, VadEngineKind::FireRed).expect("48 kHz detector");
    let d441 =
      SpeechDetector::new_with_engine(44_100.0, VadEngineKind::FireRed).expect("44.1 kHz detector");
    assert_eq!(d48.resampler_input_frames, 4_800);
    assert_eq!(d441.resampler_input_frames, 4_410);
  }

  #[test]
  fn partial_block_has_no_evidence_and_reset_discards_the_tail() {
    let mut detector =
      SpeechDetector::new_with_engine(48_000.0, VadEngineKind::FireRed).expect("detector builds");
    detector.push_mono(&vec![0.0; 4_799]);
    assert_eq!(detector.take_block_decision(), None);
    detector.push_mono(&[0.0]);
    assert_eq!(detector.take_block_decision(), Some(false));

    detector.reset();
    detector.push_mono(&[0.0]);
    assert_eq!(detector.take_block_decision(), None);
    assert_eq!(detector.in_buf.len(), 1);
  }

  // Integration smoke test: exercises the full mono->resample->Silero->vote chain on real
  // audio. Pure silence must come out as non-speech. The positive (speech->true) path needs
  // a real recording and is covered by manual verification per the design spec.
  #[test]
  fn silence_is_not_classified_as_speech() {
    let mut d = SpeechDetector::new(48_000.0).expect("detector builds from bundled model");
    let silence = vec![0.0_f32; 48_000]; // 1s of silence at 48 kHz
    d.push_mono(&silence);
    assert!(
      !d.take_block_decision().unwrap_or(false),
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
      !d.take_block_decision().unwrap_or(false),
      "pure silence must not be classified as speech by FireRed"
    );
  }
}
