#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VadDecision {
  pub active: bool,
  pub voice_probability: Option<f32>,
  pub speech_probability: Option<f32>,
  pub singing_probability: Option<f32>,
  pub music_probability: Option<f32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VadAggregationMode {
  Majority,
}

/// Engine-neutral evidence for one exact dialogue block. Probability fields are summaries only;
/// fusion uses the engine's own thresholded `active` decision and never compares scores produced
/// by different models.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VadBlockEvidence {
  pub active: bool,
  pub frame_count: usize,
  pub active_frame_count: usize,
  pub mean_voice_probability: Option<f32>,
  pub mean_speech_probability: Option<f32>,
  pub mean_singing_probability: Option<f32>,
  pub mean_music_probability: Option<f32>,
}

#[derive(Default)]
struct ProbabilityAccumulator {
  sum: f64,
  count: usize,
}

impl ProbabilityAccumulator {
  fn record(&mut self, value: Option<f32>) {
    if let Some(value) = value.filter(|value| value.is_finite()) {
      self.sum += value as f64;
      self.count += 1;
    }
  }

  fn mean(&self) -> Option<f32> {
    (self.count > 0).then_some((self.sum / self.count as f64) as f32)
  }

  fn reset(&mut self) {
    *self = Self::default();
  }
}

pub struct VadBlockAggregator {
  mode: VadAggregationMode,
  active: usize,
  total: usize,
  voice_probability: ProbabilityAccumulator,
  speech_probability: ProbabilityAccumulator,
  singing_probability: ProbabilityAccumulator,
  music_probability: ProbabilityAccumulator,
}

impl VadBlockAggregator {
  pub fn new(mode: VadAggregationMode) -> Self {
    Self {
      mode,
      active: 0,
      total: 0,
      voice_probability: ProbabilityAccumulator::default(),
      speech_probability: ProbabilityAccumulator::default(),
      singing_probability: ProbabilityAccumulator::default(),
      music_probability: ProbabilityAccumulator::default(),
    }
  }

  pub fn majority() -> Self {
    Self::new(VadAggregationMode::Majority)
  }

  pub fn record(&mut self, decision: VadDecision) {
    self.total += 1;
    if decision.active {
      self.active += 1;
    }
    self.voice_probability.record(decision.voice_probability);
    self.speech_probability.record(decision.speech_probability);
    self
      .singing_probability
      .record(decision.singing_probability);
    self.music_probability.record(decision.music_probability);
  }

  pub fn is_active(&self) -> bool {
    match self.mode {
      VadAggregationMode::Majority => self.total > 0 && self.active * 2 >= self.total,
    }
  }

  pub fn has_evidence(&self) -> bool {
    self.total > 0
  }

  pub fn take_decision(&mut self) -> bool {
    let decision = self.is_active();
    self.reset();
    decision
  }

  pub fn take_evidence(&mut self) -> Option<VadBlockEvidence> {
    if !self.has_evidence() {
      return None;
    }
    let evidence = VadBlockEvidence {
      active: self.is_active(),
      frame_count: self.total,
      active_frame_count: self.active,
      mean_voice_probability: self.voice_probability.mean(),
      mean_speech_probability: self.speech_probability.mean(),
      mean_singing_probability: self.singing_probability.mean(),
      mean_music_probability: self.music_probability.mean(),
    };
    self.reset();
    Some(evidence)
  }

  pub fn reset(&mut self) {
    self.active = 0;
    self.total = 0;
    self.voice_probability.reset();
    self.speech_probability.reset();
    self.singing_probability.reset();
    self.music_probability.reset();
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn majority_is_active_when_at_least_half_frames_are_active() {
    let mut a = VadBlockAggregator::majority();
    a.record(VadDecision {
      active: true,
      ..VadDecision::default()
    });
    a.record(VadDecision {
      active: true,
      ..VadDecision::default()
    });
    a.record(VadDecision {
      active: false,
      ..VadDecision::default()
    });

    assert!(a.is_active());
  }

  #[test]
  fn majority_is_inactive_when_minority_frames_are_active() {
    let mut a = VadBlockAggregator::majority();
    a.record(VadDecision {
      active: true,
      ..VadDecision::default()
    });
    a.record(VadDecision {
      active: false,
      ..VadDecision::default()
    });
    a.record(VadDecision {
      active: false,
      ..VadDecision::default()
    });

    assert!(!a.is_active());
  }

  #[test]
  fn majority_with_no_frames_is_inactive() {
    let a = VadBlockAggregator::majority();
    assert!(!a.is_active());
  }

  #[test]
  fn take_decision_resets_the_block() {
    let mut a = VadBlockAggregator::majority();
    a.record(VadDecision {
      active: true,
      ..VadDecision::default()
    });

    assert!(a.take_decision());
    assert!(!a.is_active());
  }

  #[test]
  fn evidence_preserves_probability_summaries_without_changing_the_vote() {
    let mut a = VadBlockAggregator::majority();
    a.record(VadDecision {
      active: true,
      voice_probability: Some(0.8),
      speech_probability: Some(0.7),
      ..VadDecision::default()
    });
    a.record(VadDecision {
      active: false,
      voice_probability: Some(0.2),
      speech_probability: None,
      music_probability: Some(0.9),
      ..VadDecision::default()
    });

    let evidence = a.take_evidence().expect("evidence");
    assert!(evidence.active);
    assert_eq!(evidence.frame_count, 2);
    assert_eq!(evidence.active_frame_count, 1);
    assert!((evidence.mean_voice_probability.unwrap() - 0.5).abs() < 1e-6);
    assert!((evidence.mean_speech_probability.unwrap() - 0.7).abs() < 1e-6);
    assert_eq!(evidence.mean_singing_probability, None);
    assert!((evidence.mean_music_probability.unwrap() - 0.9).abs() < 1e-6);
    assert!(!a.has_evidence());
  }
}
