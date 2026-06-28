use ort::value::Tensor;
use ort::{session::builder::GraphOptimizationLevel, session::Session};
use std::sync::{Arc, LazyLock, Mutex};

use crate::{error::Error, Sample};

/// A voice activity detector session.
#[derive(Debug)]
pub struct VoiceActivityDetector {
  session: Arc<Mutex<Session>>,
  chunk_size: usize,
  sample_rate: i64,
  state: ndarray::ArrayD<f32>,
}

/// The silero ONNX model as bytes.
const MODEL: &[u8] = include_bytes!("silero_vad.onnx");

static DEFAULT_SESSION: LazyLock<Arc<Mutex<Session>>> = LazyLock::new(|| {
  Arc::new(Mutex::new({
    Session::builder()
      .unwrap()
      .with_optimization_level(GraphOptimizationLevel::Level3)
      .unwrap()
      .with_intra_threads(1)
      .unwrap()
      .with_inter_threads(1)
      .unwrap()
      .commit_from_memory(MODEL)
      .unwrap()
  }))
});

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
    let mut input = ndarray::Array2::<f32>::zeros((1, self.chunk_size));
    for (i, sample) in samples.into_iter().take(self.chunk_size).enumerate() {
      input[[0, i]] = sample.to_f32();
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
}

impl From<VoiceActivityDetectorConfig> for Result<VoiceActivityDetector, Error> {
  fn from(value: VoiceActivityDetectorConfig) -> Self {
    // Silero VAD V5 model restriction:
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

    let session = match value.session {
      Some(s) => s,
      None => DEFAULT_SESSION.clone(),
    };

    Ok(VoiceActivityDetector {
      session,
      chunk_size,
      sample_rate,
      state: ndarray::Array3::<f32>::zeros((2, 1, 128)).into_dyn(),
    })
  }
}
