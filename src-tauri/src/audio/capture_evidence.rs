//! Opt-in capture-harness evidence. Never called on the audio callback thread.
//! Keep the exact Float32 samples consumed by SummaryMeter, not a second recording path.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::mpsc::{sync_channel, SyncSender};
use std::thread::JoinHandle;

const WINDOW_SECONDS: usize = 3;
const WARMUP_SECONDS: f64 = 120.0;
const JUMP_DB: f64 = 0.01;
const MAX_CLIPS: usize = 4;

struct Clip {
  pcm: Vec<f32>,
  start_frame: u64,
  trigger_end_frame: u64,
  trigger_elapsed_seconds: f64,
  previous_peak: f64,
  trigger_peak: f64,
  end_peak: f64,
  remaining: usize,
}

pub(crate) struct EvidenceRecorder {
  channels: usize,
  window_samples: usize,
  ring: VecDeque<f32>,
  frames: u64,
  baseline: f64,
  pending: Option<Clip>,
  clips: usize,
  suppressed: usize,
  sender: SyncSender<Clip>,
  writer: JoinHandle<Result<(), String>>,
}

impl EvidenceRecorder {
  pub(crate) fn from_env(rate: u32, channels: u16) -> Result<Option<Self>, String> {
    std::env::var_os("PLVS_CAPTURE_EVIDENCE_DIR")
      .map(|path| Self::new(Path::new(&path), rate, channels))
      .transpose()
  }

  fn new(path: &Path, rate: u32, channels: u16) -> Result<Self, String> {
    let window_samples = rate as usize * channels as usize * WINDOW_SECONDS;
    if rate == 0 || channels == 0 || window_samples > 4_000_000 {
      return Err("Capture evidence format exceeds its bounded-memory budget".into());
    }
    // A fresh directory prevents replacing evidence from another run.
    std::fs::create_dir(path).map_err(|e| format!("Create evidence directory: {e}"))?;
    std::fs::write(
      path.join("format.json"),
      serde_json::to_vec_pretty(&serde_json::json!({
        "schemaVersion": 1, "sampleRateHz": rate, "channels": channels,
        "encoding": "float32 WAV; exact samples supplied to SummaryMeter",
        "preSeconds": WINDOW_SECONDS, "postSeconds": WINDOW_SECONDS,
        "warmupSeconds": WARMUP_SECONDS, "triggerDeltaDb": JUMP_DB,
        "maxClips": MAX_CLIPS
      }))
      .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let (sender, receiver) = sync_channel::<Clip>(MAX_CLIPS);
    let path = path.to_path_buf();
    let writer = std::thread::spawn(move || {
      for (index, clip) in receiver.into_iter().enumerate() {
        write_clip(&path, index + 1, rate, channels, &clip)?;
      }
      Ok(())
    });
    Ok(Self {
      channels: channels as usize,
      window_samples,
      ring: VecDeque::with_capacity(window_samples),
      frames: 0,
      baseline: f64::NEG_INFINITY,
      pending: None,
      clips: 0,
      suppressed: 0,
      sender,
      writer,
    })
  }

  pub(crate) fn observe(&mut self, pcm: &[f32], peak: f64, elapsed: f64) -> Result<(), String> {
    if !pcm.len().is_multiple_of(self.channels) || pcm.len() > self.window_samples {
      return Err("Capture evidence received oversized or incomplete PCM frames".into());
    }
    let end_frame = self.frames + (pcm.len() / self.channels) as u64;
    if let Some(clip) = self.pending.as_mut() {
      // Keep the complete final consumer chunk so its reported peak cannot refer to
      // samples trimmed out of the clip. Post-roll may exceed three seconds by a chunk.
      clip.pcm.extend_from_slice(pcm);
      clip.remaining = clip.remaining.saturating_sub(pcm.len());
      clip.end_peak = peak;
      if clip.remaining == 0 {
        let clip = self.pending.take().unwrap();
        self
          .sender
          .try_send(clip)
          .map_err(|e| format!("Queue capture evidence: {e}"))?;
      }
      self.baseline = peak;
    } else if elapsed >= WARMUP_SECONDS
      && self.baseline.is_finite()
      && peak > self.baseline + JUMP_DB
    {
      if self.clips < MAX_CLIPS {
        let mut saved = Vec::with_capacity(self.ring.len() + pcm.len() + self.window_samples);
        saved.extend(self.ring.iter().copied());
        saved.extend_from_slice(pcm);
        self.pending = Some(Clip {
          pcm: saved,
          start_frame: self.frames - (self.ring.len() / self.channels) as u64,
          trigger_end_frame: end_frame,
          trigger_elapsed_seconds: elapsed,
          previous_peak: self.baseline,
          trigger_peak: peak,
          end_peak: peak,
          remaining: self.window_samples,
        });
        self.clips += 1;
      } else {
        self.suppressed += 1;
      }
      self.baseline = peak;
    } else if elapsed < WARMUP_SECONDS || !self.baseline.is_finite() {
      self.baseline = peak;
    }
    // Retain a frame-aligned prefix, including this chunk for the next observation.
    let discard = (self.ring.len() + pcm.len()).saturating_sub(self.window_samples);
    self.ring.drain(..discard);
    self.ring.extend(pcm.iter().copied());
    self.frames = end_frame;
    Ok(())
  }

  pub(crate) fn finish(mut self) -> Result<(), String> {
    if let Some(clip) = self.pending.take() {
      self
        .sender
        .try_send(clip)
        .map_err(|e| format!("Queue final evidence: {e}"))?;
    }
    drop(self.sender);
    self
      .writer
      .join()
      .map_err(|_| "Evidence writer panicked".to_string())??;
    eprintln!(
      "Capture evidence: {} clip(s), {} later trigger(s) suppressed by limit",
      self.clips, self.suppressed
    );
    Ok(())
  }
}

fn write_clip(
  path: &Path,
  number: usize,
  rate: u32,
  channels: u16,
  clip: &Clip,
) -> Result<(), String> {
  let stem = format!("peak-{number:02}");
  let mut wav = hound::WavWriter::create(
    path.join(format!("{stem}.wav")),
    hound::WavSpec {
      channels,
      sample_rate: rate,
      bits_per_sample: 32,
      sample_format: hound::SampleFormat::Float,
    },
  )
  .map_err(|e| e.to_string())?;
  for &sample in &clip.pcm {
    wav.write_sample(sample).map_err(|e| e.to_string())?;
  }
  wav.finalize().map_err(|e| e.to_string())?;
  let metadata = serde_json::json!({
    "schemaVersion": 1, "startFrame": clip.start_frame,
    "triggerChunkEndFrame": clip.trigger_end_frame,
    "triggerElapsedSeconds": clip.trigger_elapsed_seconds,
    "previousPeakDbtp": clip.previous_peak, "triggerPeakDbtp": clip.trigger_peak,
    "observedPeakAtClipEndDbtp": clip.end_peak,
    "frames": clip.pcm.len() / channels as usize,
    "postRollComplete": clip.remaining == 0,
  });
  std::fs::write(
    path.join(format!("{stem}.json")),
    serde_json::to_vec_pretty(&metadata).map_err(|e| e.to_string())?,
  )
  .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::dsp::summary_meter::SummaryMeter;
  use std::path::PathBuf;

  fn directory(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
      "plvs-evidence-{label}-{}-{}",
      std::process::id(),
      std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
    ))
  }

  #[test]
  fn saves_exact_input_and_replays_a_real_peak_jump() {
    let dir = directory("replay");
    let mut recorder = EvidenceRecorder::new(&dir, 48_000, 2).unwrap();
    let mut meter = SummaryMeter::new(48_000, 2);
    let mut original = Vec::new();
    for block in 0..100 {
      let pcm: Vec<f32> = (block * 4800..(block + 1) * 4800)
        .flat_map(|n| {
          let sample = if (240013..240493).contains(&n) {
            0.0
          } else {
            ((2.0 * std::f64::consts::PI * 1000.0 * n as f64 / 48000.0).sin() * 0.1) as f32
          };
          [sample, sample * 0.5]
        })
        .collect();
      meter.push_interleaved(&pcm);
      // Advance the trigger clock after collecting a prefix; do not change production warmup.
      recorder
        .observe(
          &pcm,
          meter.finish().true_peak_max_dbtp,
          if block < 40 {
            block as f64 / 10.0
          } else {
            120.0 + block as f64 / 10.0
          },
        )
        .unwrap();
      original.extend_from_slice(&pcm);
    }
    recorder.finish().unwrap();
    let meta: serde_json::Value =
      serde_json::from_slice(&std::fs::read(dir.join("peak-01.json")).unwrap()).unwrap();
    let start = meta["startFrame"].as_u64().unwrap() as usize * 2;
    let saved: Vec<f32> = hound::WavReader::open(dir.join("peak-01.wav"))
      .unwrap()
      .samples::<f32>()
      .map(Result::unwrap)
      .collect();
    assert_eq!(saved, original[start..start + saved.len()]);
    assert_eq!(meta["postRollComplete"], true);
    let mut replay = SummaryMeter::new(48_000, 2);
    replay.push_interleaved(&saved);
    assert!(
      (replay.finish().true_peak_max_dbtp - meta["triggerPeakDbtp"].as_f64().unwrap()).abs() < 1e-9
    );
    assert!(!dir.join("peak-02.wav").exists());
    std::fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn retains_truncated_tail_and_refuses_existing_directory() {
    let dir = directory("tail");
    let mut recorder = EvidenceRecorder::new(&dir, 100, 2).unwrap();
    assert!(EvidenceRecorder::new(&dir, 100, 2).is_err());
    recorder.observe(&[0.1; 200], -20.0, 1.0).unwrap();
    recorder.observe(&[0.2; 200], -14.0, 121.0).unwrap();
    recorder.finish().unwrap();
    let meta: serde_json::Value =
      serde_json::from_slice(&std::fs::read(dir.join("peak-01.json")).unwrap()).unwrap();
    assert_eq!(meta["postRollComplete"], false);
    assert_eq!(meta["frames"], 200);
    std::fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn ignores_warmup_and_caps_evidence_without_blocking() {
    let dir = directory("cap");
    let mut recorder = EvidenceRecorder::new(&dir, 100, 2).unwrap();
    for i in 0..10 {
      recorder
        .observe(&[0.0; 200], -30.0 + i as f64, i as f64)
        .unwrap();
    }
    assert_eq!(recorder.clips, 0);
    for i in 0..30 {
      recorder
        .observe(&[0.0; 200], -20.0 + i as f64, 121.0 + i as f64)
        .unwrap();
    }
    assert_eq!(recorder.clips, MAX_CLIPS);
    assert!(recorder.suppressed > 0);
    recorder.finish().unwrap();
    assert!(dir.join("peak-04.wav").exists());
    assert!(!dir.join("peak-05.wav").exists());
    std::fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn reports_writer_failure_instead_of_claiming_evidence_was_saved() {
    let dir = directory("failure");
    let mut recorder = EvidenceRecorder::new(&dir, 100, 2).unwrap();
    std::fs::create_dir(dir.join("peak-01.wav")).unwrap();
    recorder.observe(&[0.1; 200], -20.0, 1.0).unwrap();
    recorder.observe(&[0.2; 200], -14.0, 121.0).unwrap();
    assert!(recorder.finish().is_err());
    std::fs::remove_dir_all(dir).unwrap();
  }
}
