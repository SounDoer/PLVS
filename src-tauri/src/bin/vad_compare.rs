use std::{
  env, fs,
  path::{Path, PathBuf},
  process::Command,
};

use app_lib::vad::{VadBlockAggregator, VadDecision};
use firered_vad::Vad as FireRedVad;
use rubato::{
  Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};
use voice_activity_detector::VoiceActivityDetector;

const VAD_RATE: usize = 16_000;
const RESAMPLER_IN_CHUNK: usize = 1024;
const SILERO_FRAME: usize = 512;

trait Engine {
  fn frame_size(&self) -> usize;
  fn predict(&mut self, frame: Vec<f32>) -> Option<bool>;
}

struct Silero {
  vad: VoiceActivityDetector,
}

impl Silero {
  fn new() -> Self {
    Self {
      vad: VoiceActivityDetector::builder()
        .sample_rate(VAD_RATE as i64)
        .chunk_size(SILERO_FRAME)
        .build()
        .expect("Silero VAD should load"),
    }
  }
}

impl Engine for Silero {
  fn frame_size(&self) -> usize {
    SILERO_FRAME
  }

  fn predict(&mut self, frame: Vec<f32>) -> Option<bool> {
    Some(self.vad.predict(frame) >= 0.5)
  }
}

struct FireRed {
  vad: FireRedVad,
}

impl FireRed {
  fn new() -> Self {
    Self {
      vad: FireRedVad::bundled().expect("FireRed VAD should load"),
    }
  }
}

impl Engine for FireRed {
  fn frame_size(&self) -> usize {
    firered_vad::FrameResult::FRAME_SHIFT_SAMPLES as usize
  }

  fn predict(&mut self, frame: Vec<f32>) -> Option<bool> {
    self.vad.push_samples(&frame).ok()?;
    self.vad.recent_frames().last().map(|f| f.is_speech())
  }
}

struct Detector<E: Engine> {
  engine: E,
  resampler: SincFixedIn<f32>,
  in_buf: Vec<f32>,
  chunk_buf: Vec<f32>,
  aggregator: VadBlockAggregator,
}

impl<E: Engine> Detector<E> {
  fn new(engine: E, source_rate: f64) -> Self {
    let params = SincInterpolationParameters {
      sinc_len: 128,
      f_cutoff: 0.95,
      oversampling_factor: 128,
      interpolation: SincInterpolationType::Linear,
      window: WindowFunction::BlackmanHarris2,
    };
    let resampler = SincFixedIn::<f32>::new(
      VAD_RATE as f64 / source_rate,
      1.0,
      params,
      RESAMPLER_IN_CHUNK,
      1,
    )
    .expect("resampler should build");
    Self {
      engine,
      resampler,
      in_buf: Vec::new(),
      chunk_buf: Vec::new(),
      aggregator: VadBlockAggregator::majority(),
    }
  }

  fn push_mono(&mut self, mono: &[f32]) {
    self.in_buf.extend_from_slice(mono);
    while self.in_buf.len() >= RESAMPLER_IN_CHUNK {
      let block: Vec<f32> = self.in_buf.drain(..RESAMPLER_IN_CHUNK).collect();
      if let Ok(out) = self.resampler.process(&[block], None) {
        self.chunk_buf.extend_from_slice(&out[0]);
      }
      let frame_size = self.engine.frame_size();
      while self.chunk_buf.len() >= frame_size {
        let frame: Vec<f32> = self.chunk_buf.drain(..frame_size).collect();
        if let Some(active) = self.engine.predict(frame) {
          self.aggregator.record(VadDecision {
            active,
            ..VadDecision::default()
          });
        }
      }
    }
  }

  fn take_block(&mut self) -> bool {
    self.aggregator.take_decision()
  }
}

struct Audio {
  samples: Vec<f32>,
  sample_rate: f64,
  channels: usize,
}

fn read_wav(path: &Path) -> Result<Audio, String> {
  let output = Command::new("ffmpeg")
    .args(["-v", "error", "-i"])
    .arg(path)
    .args(["-ar", "48000", "-ac", "2", "-f", "f32le", "pipe:1"])
    .output()
    .map_err(|err| format!("failed to run ffmpeg: {err}"))?;
  if !output.status.success() {
    return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
  }
  let samples = output
    .stdout
    .chunks_exact(4)
    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
    .collect();
  Ok(Audio {
    samples,
    sample_rate: 48_000.0,
    channels: 2,
  })
}

fn read_f32(path: &Path) -> Result<Audio, String> {
  let bytes = fs::read(path).map_err(|err| err.to_string())?;
  let samples = bytes
    .chunks_exact(4)
    .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
    .collect();
  Ok(Audio {
    samples,
    sample_rate: 48_000.0,
    channels: 2,
  })
}

fn read_audio(path: &Path) -> Result<Audio, String> {
  match path.extension().and_then(|ext| ext.to_str()) {
    Some("wav") => read_wav(path),
    Some("f32") => read_f32(path),
    _ => Err("unsupported extension".into()),
  }
}

fn downmix(block: &[f32], channels: usize) -> Vec<f32> {
  block
    .chunks_exact(channels)
    .map(|frame| frame.iter().sum::<f32>() / channels as f32)
    .collect()
}

fn run<E: Engine>(mut detector: Detector<E>, audio: &Audio) -> (usize, usize) {
  let block_samples = ((audio.sample_rate * 0.1).round() as usize).max(1) * audio.channels;
  let mut blocks = 0;
  let mut active = 0;
  for block in audio.samples.chunks(block_samples) {
    if block.len() < block_samples {
      break;
    }
    detector.push_mono(&downmix(block, audio.channels));
    if detector.take_block() {
      active += 1;
    }
    blocks += 1;
  }
  (active, blocks)
}

fn main() {
  let dir = env::args()
    .nth(1)
    .expect("usage: cargo run --bin vad_compare -- <audio-dir>");
  let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
    .expect("audio dir should be readable")
    .map(|entry| entry.expect("dir entry").path())
    .filter(|path| {
      matches!(
        path.extension().and_then(|ext| ext.to_str()),
        Some("wav" | "f32")
      )
    })
    .collect();
  paths.sort();

  println!("file,ext,engine,active_blocks,total_blocks,coverage_pct,duration_s");
  for path in paths {
    let name = path.file_stem().unwrap().to_string_lossy();
    let ext = path.extension().unwrap().to_string_lossy();
    let audio = match read_audio(&path) {
      Ok(audio) => audio,
      Err(err) => {
        eprintln!("skip {}: {err}", path.display());
        continue;
      }
    };
    let duration = audio.samples.len() as f64 / audio.channels as f64 / audio.sample_rate;

    let (active, blocks) = run(Detector::new(Silero::new(), audio.sample_rate), &audio);
    println!(
      "{name},{ext},Silero,{active},{blocks},{:.1},{duration:.1}",
      100.0 * active as f64 / blocks as f64
    );

    let (active, blocks) = run(Detector::new(FireRed::new(), audio.sample_rate), &audio);
    println!(
      "{name},{ext},FireRed,{active},{blocks},{:.1},{duration:.1}",
      100.0 * active as f64 / blocks as f64
    );
  }
}
