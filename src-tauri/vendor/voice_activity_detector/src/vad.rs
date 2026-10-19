use ort::value::Tensor;
use ort::{session::builder::GraphOptimizationLevel, session::Session};
use std::sync::{Arc, Mutex};

use crate::{error::Error, Sample};

/// A voice activity detector session.
#[derive(Debug)]
pub struct VoiceActivityDetector {
  session: Arc<Mutex<Session>>,
  chunk_size: usize,
  sample_rate: i64,
  state: ndarray::ArrayD<f32>,
  context: Vec<f32>,
  context_size: usize,
}

/// The silero ONNX model as bytes.
const MODEL: &[u8] = include_bytes!("silero_vad.onnx");

/// Each detector gets its own session unless the caller passes one. PLVS runs one detector per
/// channel and spreads channels over threads; a shared session behind one lock would put every
/// channel's inference back in a single queue.
fn new_session() -> Arc<Mutex<Session>> {
  Arc::new(Mutex::new(
    Session::builder()
      .unwrap()
      .with_optimization_level(GraphOptimizationLevel::Level3)
      .unwrap()
      .with_intra_threads(1)
      .unwrap()
      .with_inter_threads(1)
      .unwrap()
      .commit_from_memory(MODEL)
      .unwrap(),
  ))
}

impl VoiceActivityDetector {
  /// Create a new [VoiceActivityDetectorBuilder].
  pub fn builder() -> VoiceActivityDetectorBuilder {
    VoiceActivityDetectorConfig::builder()
  }

  /// Gets the chunks size
  pub(crate) fn chunk_size(&self) -> usize {
    self.chunk_size
  }

  /// Resets the state of the voice activity detector session.
  pub fn reset(&mut self) {
    self.state = ndarray::Array3::<f32>::zeros((2, 1, 128)).into_dyn();
    self.context.fill(0.0);
  }

  /// Predicts the existence of speech in a single iterable of audio.
  ///
  /// The samples iterator will be padded if it is too short, or truncated if it is
  /// too long.
  pub fn predict<S, I>(&mut self, samples: I) -> f32
  where
    S: Sample,
    I: IntoIterator<Item = S>,
  {
    let mut input = ndarray::Array2::<f32>::zeros((1, self.context_size + self.chunk_size));
    for (index, sample) in self.context.iter().copied().enumerate() {
      input[[0, index]] = sample;
    }
    for (index, sample) in samples.into_iter().take(self.chunk_size).enumerate() {
      input[[0, self.context_size + index]] = sample.to_f32();
    }
    if self.context_size > 0 {
      let context_start = self.context_size + self.chunk_size - self.context_size;
      for index in 0..self.context_size {
        self.context[index] = input[[0, context_start + index]];
      }
    }

    let sample_rate = ndarray::arr0::<i64>(self.sample_rate);
    let state_taken = std::mem::take(&mut self.state);

    // ort::inputs! macro no longer supports ArrayView, use Tensor::from_array instead
    let inputs = ort::inputs![
      Tensor::from_array(input.to_owned()).unwrap(),
      Tensor::from_array(state_taken.to_owned()).unwrap(),
      Tensor::from_array(sample_rate.to_owned()).unwrap(),
    ];

    let mut session = self.session.lock().unwrap();
    let outputs = session.run(inputs).unwrap();

    // Update state recursively.
    self.state = outputs
      .get("stateN")
      .unwrap()
      .try_extract_array::<f32>()
      .unwrap()
      .to_owned();

    // Get the probability of speech.
    let output = outputs
      .get("output")
      .unwrap()
      .try_extract_array::<f32>()
      .unwrap();
    output[[0, 0]]
  }
}

/// The configuration for the [VoiceActivityDetector]. Used to create
/// a [VoiceActivityDetectorBuilder] that performs runtime validation on build.
#[derive(Debug, typed_builder::TypedBuilder)]
#[builder(
    builder_method(vis = ""),
    builder_type(name = VoiceActivityDetectorBuilder, vis = "pub"),
    build_method(into = Result<VoiceActivityDetector, Error>, vis = "pub"))
]
struct VoiceActivityDetectorConfig {
  #[builder(setter(into))]
  chunk_size: usize,
  #[builder(setter(into))]
  sample_rate: i64,
  #[builder(default, setter(strip_option))]
  session: Option<Arc<Mutex<Session>>>,
  /// Number of previous samples prepended to each model input. Silero v6.2 uses 64 at 16 kHz
  /// (or 32 at 8 kHz).
  #[builder(default, setter(strip_option))]
  context_size: Option<usize>,
}

impl From<VoiceActivityDetectorConfig> for Result<VoiceActivityDetector, Error> {
  fn from(value: VoiceActivityDetectorConfig) -> Self {
    // Silero VAD v6.2 model restriction:
    // - For 8 kHz, only chunk_size 256 is allowed
    // - For 16 kHz, only chunk_size 512 is allowed
    let sample_rate = value.sample_rate;
    let chunk_size = match sample_rate {
      8000 => 256,
      16000 => 512,
      _ => {
        return Err(Error::VadConfigError {
          sample_rate,
          chunk_size: value.chunk_size,
        });
      }
    };
    let context_size = value
      .context_size
      .unwrap_or(if sample_rate == 16_000 { 64 } else { 32 });

    let session = value.session.unwrap_or_else(new_session);

    Ok(VoiceActivityDetector {
      session,
      chunk_size,
      sample_rate,
      state: ndarray::Array3::<f32>::zeros((2, 1, 128)).into_dyn(),
      context: vec![0.0; context_size],
      context_size,
    })
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn v6_streaming_context_defaults_follow_sample_rate() {
    let detector_16k = VoiceActivityDetector::builder()
      .sample_rate(16_000)
      .chunk_size(512_usize)
      .build()
      .expect("16 kHz detector");
    let detector_8k = VoiceActivityDetector::builder()
      .sample_rate(8_000)
      .chunk_size(256_usize)
      .build()
      .expect("8 kHz detector");
    assert_eq!(detector_16k.context_size, 64);
    assert_eq!(detector_8k.context_size, 32);
  }
}
