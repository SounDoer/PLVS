//! Live dialogue detection on its own thread.
//!
//! Multichannel detection runs one VAD per non-LFE channel, so its cost grows with the channel
//! count: at 8 channels it took about a third of a core, with single blocks over 100 ms. Inline on
//! the meter thread, that delayed metering and the measured PCM that recordings take from the same
//! thread. The meter thread now hands each complete 100 ms block to this worker and reads results
//! back as they finish.
//!
//! The worker sees the same blocks in the same order as the inline path and runs the same
//! detector, fusion and integrator, so every dialogue value is identical; Live readings only arrive
//! a block or two later. When the worker falls more than [`DIALOGUE_WORKER_BACKLOG_BLOCKS`] behind,
//! blocks are never skipped: the measurement stops with `detectorOverloaded` until the next coherent
//! dialogue reset, because a skipped block would silently change the result.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::Arc;

use super::dialogue::DialogueIntegrator;
use super::speech::{MultichannelSpeechDetector, VadEngineKind};

/// Three seconds of 100 ms blocks may wait for the worker before the measurement stops.
pub(crate) const DIALOGUE_WORKER_BACKLOG_BLOCKS: usize = 30;

pub(crate) const DETECTOR_OVERLOADED: &str = "detectorOverloaded";

/// The dialogue state after one block, as the inline path leaves it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DialogueOutcome {
  /// `(integrated, lra, percent)` for the block, or `None` when the block keeps the dialogue-off
  /// values because detection is unavailable.
  pub values: Option<(f64, f64, f64)>,
  pub speech_now: bool,
  pub error: Option<&'static str>,
}

/// One block of work: the block's interleaved source PCM and its programme mean square.
struct DialogueJob {
  pcm: Vec<f32>,
  channels: u16,
  mean_square: [f64; 2],
}

/// Detector, fusion and integrator for one dialogue measurement, shared by the inline path and
/// the worker so both settle a block the same way.
pub(crate) struct DialogueSession {
  detector: Option<MultichannelSpeechDetector>,
  integrator: DialogueIntegrator,
  error: Option<&'static str>,
}

impl DialogueSession {
  pub(crate) fn new(
    sample_rate: f64,
    kind: VadEngineKind,
    channels: u16,
    roles: Option<&[String]>,
  ) -> Self {
    let detector = MultichannelSpeechDetector::new(sample_rate, kind, channels, roles);
    let error = detector.is_none().then_some("initializationFailed");
    Self {
      detector,
      integrator: DialogueIntegrator::new(),
      error,
    }
  }

  pub(crate) fn error(&self) -> Option<&'static str> {
    self.error
  }

  pub(crate) fn push_interleaved(&mut self, interleaved: &[f32], channels: u16) {
    if let Some(detector) = self.detector.as_mut() {
      detector.push_interleaved(interleaved, channels);
    }
  }

  pub(crate) fn settle_block(&mut self, mean_square: [f64; 2]) -> DialogueOutcome {
    let Some(detector) = self.detector.as_mut() else {
      return DialogueOutcome {
        values: None,
        speech_now: false,
        error: self.error,
      };
    };
    match detector.take_block_decision() {
      Some(is_speech) => {
        self.integrator.push_block(mean_square, is_speech);
        DialogueOutcome {
          values: Some(self.values()),
          speech_now: is_speech,
          error: self.error,
        }
      }
      None if detector.has_failed() => {
        self.error = Some("runtimeFailed");
        DialogueOutcome {
          values: None,
          speech_now: false,
          error: self.error,
        }
      }
      None => DialogueOutcome {
        values: Some(self.values()),
        speech_now: false,
        error: self.error,
      },
    }
  }

  fn values(&self) -> (f64, f64, f64) {
    (
      self.integrator.integrated(),
      self.integrator.lra(),
      self.integrator.percent(),
    )
  }

  #[cfg(test)]
  pub(crate) fn valid_blocks_for_test(&self) -> usize {
    self.integrator.valid_blocks_for_test()
  }
}

/// The meter thread's handle on one worker. Dropping it stops the worker without waiting for it.
pub(crate) struct DialogueWorker {
  jobs: SyncSender<DialogueJob>,
  outcomes: Receiver<DialogueOutcome>,
  spare: Receiver<Vec<f32>>,
  cancelled: Arc<AtomicBool>,
  block_pcm: Vec<f32>,
  overloaded: bool,
  #[cfg(test)]
  outstanding: usize,
}

impl DialogueWorker {
  /// Starts a worker that builds its detector on its own thread, so model loading never stalls
  /// the meter either. `None` only when the OS refuses a thread.
  pub(crate) fn spawn(
    sample_rate: f64,
    kind: VadEngineKind,
    channels: u16,
    roles: Option<Vec<String>>,
  ) -> Option<Self> {
    Self::spawn_gated(sample_rate, kind, channels, roles, None)
  }

  /// As `spawn`; with `start`, the worker takes no job until that channel yields or closes.
  fn spawn_gated(
    sample_rate: f64,
    kind: VadEngineKind,
    channels: u16,
    roles: Option<Vec<String>>,
    start: Option<Receiver<()>>,
  ) -> Option<Self> {
    let (jobs, job_rx) = mpsc::sync_channel::<DialogueJob>(DIALOGUE_WORKER_BACKLOG_BLOCKS);
    // Unbounded on purpose: one outcome per accepted job, and the meter drains them every block.
    let (outcome_tx, outcomes) = mpsc::channel();
    let (spare_tx, spare) = mpsc::sync_channel(DIALOGUE_WORKER_BACKLOG_BLOCKS + 1);
    let cancelled = Arc::new(AtomicBool::new(false));
    let worker_cancelled = cancelled.clone();
    std::thread::Builder::new()
      .name("plvs-dialogue".into())
      .spawn(move || {
        let mut session = DialogueSession::new(sample_rate, kind, channels, roles.as_deref());
        if let Some(start) = start {
          let _ = start.recv();
        }
        while let Ok(job) = job_rx.recv() {
          if worker_cancelled.load(Ordering::Acquire) {
            break;
          }
          session.push_interleaved(&job.pcm, job.channels);
          let outcome = session.settle_block(job.mean_square);
          if outcome_tx.send(outcome).is_err() {
            break;
          }
          let _ = spare_tx.try_send(job.pcm);
        }
      })
      .ok()?;
    Some(Self {
      jobs,
      outcomes,
      spare,
      cancelled,
      block_pcm: Vec::new(),
      overloaded: false,
      #[cfg(test)]
      outstanding: 0,
    })
  }

  /// A worker that holds every job until the returned sender sends or is dropped.
  #[cfg(test)]
  pub(crate) fn spawn_paused(
    sample_rate: f64,
    kind: VadEngineKind,
    channels: u16,
  ) -> Option<(Self, SyncSender<()>)> {
    let (release, start) = mpsc::sync_channel(1);
    Self::spawn_gated(sample_rate, kind, channels, None, Some(start))
      .map(|worker| (worker, release))
  }

  /// Adds the part of the current 100 ms block that just arrived.
  pub(crate) fn push_interleaved(&mut self, interleaved: &[f32]) {
    if !self.overloaded {
      self.block_pcm.extend_from_slice(interleaved);
    }
  }

  /// Hands the completed block to the worker. Returns `false` once the worker is too far behind;
  /// the measurement then stays stopped until the worker is replaced.
  pub(crate) fn submit_block(&mut self, channels: u16, mean_square: [f64; 2]) -> bool {
    if self.overloaded {
      return false;
    }
    let mut next = self.spare.try_recv().unwrap_or_default();
    next.clear();
    let pcm = std::mem::replace(&mut self.block_pcm, next);
    match self.jobs.try_send(DialogueJob {
      pcm,
      channels,
      mean_square,
    }) {
      Ok(()) => {
        #[cfg(test)]
        {
          self.outstanding += 1;
        }
        true
      }
      Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
        self.overloaded = true;
        self.cancelled.store(true, Ordering::Release);
        self.block_pcm = Vec::new();
        false
      }
    }
  }

  /// Outcomes finished since the last call, oldest first.
  pub(crate) fn drain(&mut self) -> Vec<DialogueOutcome> {
    let outcomes: Vec<_> = self.outcomes.try_iter().collect();
    #[cfg(test)]
    {
      self.outstanding -= outcomes.len();
    }
    outcomes
  }

  /// Every outcome still owed, waiting for the worker. Tests only: Live never waits.
  #[cfg(test)]
  pub(crate) fn wait_for_outstanding(&mut self) -> Vec<DialogueOutcome> {
    let outcomes: Vec<_> = (0..self.outstanding)
      .map_while(|_| self.outcomes.recv().ok())
      .collect();
    self.outstanding -= outcomes.len();
    outcomes
  }
}

impl Drop for DialogueWorker {
  fn drop(&mut self) {
    self.cancelled.store(true, Ordering::Release);
  }
}
