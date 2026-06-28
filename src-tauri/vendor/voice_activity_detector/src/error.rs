/// An enum of all errors returned by the voice activity detector functions.
#[derive(thiserror::Error, Debug)]
pub enum Error {
  /// The VAD configuration must use a supported sample rate and chunk size combination.
  #[error("unsupported VAD configuration: sample_rate={sample_rate}, chunk_size={chunk_size}. Only 8kHz/256, 16kHz/512 are allowed.")]
  VadConfigError {
    /// The sample rate for the VAD.
    sample_rate: i64,
    /// The chunk size for the VAD.
    chunk_size: usize,
  },
}
