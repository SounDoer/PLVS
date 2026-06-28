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

Spike checklist:

- Prefer a Rust/ONNX or NCNN path that does not require Python at runtime.
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
