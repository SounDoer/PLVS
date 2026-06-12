//! Slice 0 packaging spike: prove `voice_activity_detector` (Silero VAD via `ort`)
//! compiles, links, loads its bundled model, and runs one inference in this project's
//! toolchain + dependency tree. Not a shipped feature — delete once Slice 1 lands.

use voice_activity_detector::VoiceActivityDetector;

/// Builds a 16 kHz / 512-sample Silero VAD, runs it on synthetic silence and a tone,
/// and asserts the model produces finite probabilities in [0, 1] for both.
#[test]
fn silero_vad_loads_and_predicts() {
  let mut vad = VoiceActivityDetector::builder()
    .sample_rate(16_000)
    .chunk_size(512usize)
    .build()
    .expect("Silero VAD should build from the bundled model");

  // Silence → low speech probability, but the point of the spike is "it runs".
  let silence = vec![0.0_f32; 512];
  let p_silence = vad.predict(silence);
  assert!(
    p_silence.is_finite() && (0.0..=1.0).contains(&p_silence),
    "silence probability should be a valid [0,1] value, got {p_silence}"
  );

  // A 300 Hz tone, just to feed non-zero energy through the model.
  let tone: Vec<f32> = (0..512)
    .map(|i| (2.0 * std::f32::consts::PI * 300.0 * i as f32 / 16_000.0).sin() * 0.3)
    .collect();
  let p_tone = vad.predict(tone);
  assert!(
    p_tone.is_finite() && (0.0..=1.0).contains(&p_tone),
    "tone probability should be a valid [0,1] value, got {p_tone}"
  );

  println!("VAD spike OK: p(silence)={p_silence:.4}, p(tone)={p_tone:.4}");
}
