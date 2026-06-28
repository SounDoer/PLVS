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

pub struct VadBlockAggregator {
  mode: VadAggregationMode,
  active: usize,
  total: usize,
}

impl VadBlockAggregator {
  pub fn new(mode: VadAggregationMode) -> Self {
    Self {
      mode,
      active: 0,
      total: 0,
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
  }

  pub fn is_active(&self) -> bool {
    match self.mode {
      VadAggregationMode::Majority => self.total > 0 && self.active * 2 >= self.total,
    }
  }

  pub fn take_decision(&mut self) -> bool {
    let decision = self.is_active();
    self.reset();
    decision
  }

  pub fn reset(&mut self) {
    self.active = 0;
    self.total = 0;
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
}
