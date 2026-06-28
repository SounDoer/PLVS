# VAD Engine Expansion Plan

**Date:** 2026-06-28
**Status:** Draft

## Goal

Let the dialogue-gated loudness sidechain support multiple VAD engines without changing the
existing dialogue readouts or promising user-facing engine modes before we have fixture results.

Priority order:

1. FireRedVAD
2. TEN VAD
3. FunASR FSMN-VAD

## Current foundation

`src-tauri/src/dsp/speech.rs` now separates the streaming detector from the concrete model:

- `SpeechDetector` owns downmix-resampled 16 kHz buffering and per-100 ms block voting.
- `DialogueVadEngine` is the model adapter boundary.
- `SileroVadEngine` is the only implemented adapter and preserves the previous default behavior:
  512-sample frames, probability threshold `0.5`, then block-level majority voting.

## Non-goals for this pass

- No frontend engine picker.
- No user-facing labels such as balanced, low latency, music-aware, or Chinese speech.
- No change to the four dialogue readouts or their visibility-driven gating behavior.
- No claim that any engine is standards-compliant dialogue intelligence.

## Shared engine contract

Each engine adapter should expose:

- Required 16 kHz frame size.
- Per-frame decision with `active`.
- Optional probability channels:
  - `voice_probability`
  - `speech_probability`
  - `singing_probability`
  - `music_probability`
- Reset semantics that clear streaming model state and post-processing buffers.

`DialogueIntegrator` should continue to consume only the final per-100 ms `active` decision until
we intentionally add richer product semantics.

## FireRedVAD spike

Why first:

- FireRedVAD is the best candidate for improving real-world media behavior.
- The binary VAD path detects voice activity, while FireRed's multi-label direction may let us
  separate speech, singing, and music later.

Current dependency finding:

- `firered-vad = 0.1.0` is the most direct Rust wrapper and exposes the right streaming API:
  `Vad::push_samples(&[f32])` accepts 16 kHz mono float samples, and `recent_frames()` exposes 10 ms
  frame-level raw/smoothed probabilities.
- It currently pins `ort = 2.0.0-rc.12`.
- The existing `voice_activity_detector = 0.2.1` Silero dependency pins `ort = 2.0.0-rc.10`.
- Cargo cannot resolve both in the same package, so FireRed should be proven in an isolated spike
  before changing the main PLVS dependency graph.
- Isolated Windows smoke result: a temporary `firered-vad = 0.1.0` binary built and ran with the
  bundled model. Feeding 1 second of 16 kHz silence produced 98 frame results, `active=0`, and
  `max_smoothed_prob=0.012999`.
- Temporary compatibility test: copying `voice_activity_detector = 0.2.1` and changing its
  `ort` dependency to `2.0.0-rc.12` also required changing its `ndarray` dependency to `0.17.2`.
  With both changes, a temporary binary successfully ran Silero and FireRed in the same process:
  Silero returned `0.044263` for a silent 512-sample frame, and FireRed returned 98 silence frames.

Spike checklist:

- Prefer a Rust/ONNX or NCNN path that does not require Python at runtime.
- Keep `firered-vad` out of `src-tauri/Cargo.toml` until the ONNX runtime version strategy is chosen.
- Decide between:
  - replacing `voice_activity_detector` with a Silero path compatible with `ort rc.12`;
  - vendoring/patching the small existing Silero wrapper to `ort rc.12` plus `ndarray 0.17.2`;
  - keeping FireRed outside the hot path until a compatible crate version exists.
- Confirm Windows and macOS packaging in Tauri.
- Measure model/runtime size and startup cost.
- Feed streaming 10 ms frames into the existing 100 ms block vote.
- Compare fixture results against Silero:
  - dialogue coverage
  - false speech during instrumental music
  - speech missed in noisy/mixed content
  - final dialogue integrated loudness delta

## TEN VAD spike

Why second:

- TEN VAD is attractive as a low-latency, very small real-time engine.
- It may be easier to keep as a runtime-light option if its platform libraries package cleanly.

Spike checklist:

- Start with a Rust wrapper or direct C ABI proof.
- Confirm 16 kHz / 160 or 256 sample frame behavior.
- Verify dynamic-library packaging for Windows and macOS.
- Compare latency and boundary stability against Silero and FireRed.

## FunASR FSMN-VAD spike

Why third:

- FunASR FSMN-VAD may be useful for Chinese/ASR-style segmentation.
- It is also likely to prefer recall over precision, which can inflate dialogue loudness if it
  over-predicts speech in music or noise.

Spike checklist:

- Prefer ONNX/runtime-only integration over Python.
- Confirm whether streaming chunks can be reduced cleanly to per-frame/per-block probabilities.
- Benchmark Chinese speech fixtures separately from multilingual/media fixtures.
- Watch false positives carefully; high recall is not automatically good for loudness metering.

## Validation

Before exposing any engine choice to users, build a local fixture runner that reports per-engine:

- coverage percentage
- active block count
- dialogue integrated loudness
- disagreement count versus annotated fixtures
- per-content notes for speech, music, singing, and noisy mixed material
