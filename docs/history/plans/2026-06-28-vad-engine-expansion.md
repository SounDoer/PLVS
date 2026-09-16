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

The frame-to-block bridge is now `vad::VadBlockAggregator`. The only implemented mode is
`Majority`, preserving the original behavior:
at least half of the VAD frames recorded during a 100 ms loudness block must be active for the block
to count as dialogue.

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
- Mainline dependency strategy chosen for the first FireRed spike: `voice_activity_detector` is
  vendored under `src-tauri/vendor/voice_activity_detector` with the same `ort rc.12` +
  `ndarray 0.17.2` patch. `src-tauri` can now depend on both the patched Silero wrapper and
  `firered-vad = 0.1.0`.
- `VadEngineKind::FireRed` is implemented behind the same internal `DialogueVadEngine` adapter
  interface. `SpeechDetector::new()` still defaults to Silero; FireRed is only exercised by
  explicit internal construction/tests.

Spike checklist:

- Prefer a Rust/ONNX or NCNN path that does not require Python at runtime.
- Keep FireRed out of user-facing settings until fixture comparison exists.
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

Current dependency finding:

- `ten-vad-rs = 0.1.7` is the preferred Rust path. It uses `ort = 2.0.0-rc.12` and
  `ndarray = 0.17.2`, matching the dependency graph already needed by FireRed and the vendored
  Silero wrapper.
- The crate's embedded ONNX model is small: `ten-vad.onnx` is about `315 KB`.
- The alternative `ten_vad = 0.1.0` crate was rejected for now because its Windows build expects
  ONNX Runtime C headers via `ORT_ROOT`/`ONNXRUNTIME_DIR`, which would complicate PLVS packaging.
- Mainline strategy: vendor `ten-vad.onnx` and its Apache-2.0 license under
  `src-tauri/vendor/ten-vad-rs`, load it with `TenVad::new_from_bytes`, and keep `SpeechDetector`
  defaulting to Silero.
- `VadEngineKind::Ten` is implemented behind the same internal `DialogueVadEngine` adapter
  interface. It uses 256-sample frames at 16 kHz and the same `0.5` active threshold before the
  shared 100 ms majority aggregator.

Spike checklist:

- Start with a Rust wrapper or direct C ABI proof. Done with `ten-vad-rs`.
- Confirm 16 kHz / 160 or 256 sample frame behavior. Done: adapter uses 256 samples.
- Verify dynamic-library packaging for Windows and macOS.
- Compare latency and boundary stability against Silero and FireRed.

## FunASR FSMN-VAD spike

**Decision (2026-06-30): deferred. Not integrating for now.** Kept as a design note below so a
future revisit does not re-derive the same blockers.

Why third:

- FunASR FSMN-VAD may be useful for Chinese/ASR-style segmentation.
- It is also likely to prefer recall over precision, which can inflate dialogue loudness if it
  over-predicts speech in music or noise.

Why deferred (the two hard blockers):

1. **Not a drop-in same-shape engine.** Silero, FireRed, and TEN all consume raw 16 kHz `f32`
   samples directly, which is why they share the `DialogueVadEngine` / `predict(Vec<f32>)`
   contract and `SpeechDetector`'s fixed-size chunk loop. FSMN-VAD's ONNX does **not** take raw
   PCM. It expects an upstream feature frontend that FunASR keeps outside the model (`WavFrontend`
   in their Python/C++ runtime): 80-dim fbank + LFR (low-frame-rate splice) + CMVN normalization
   using a bundled `am.mvn` stats file. None of that exists in Rust here. Integrating FunASR means
   re-implementing a small ASR-style feature frontend plus FSMN streaming state — substantially
   more work than the other three engines combined, and it does not fit the current
   `predict(Vec<f32>)` interface cleanly (the engine would need to own its own buffering / bypass
   the shared equal-size chunk loop).
2. **License.** The visible Rust crate `rlx-funasr = 0.2.9` is `GPL-3.0-only`; linking it into the
   Tauri app would impose GPL on all of PLVS, which is unacceptable for distribution. The model
   weights themselves are under the FunASR Model License (commercial use allowed, attribution
   required), so the only clean path is ONNX-only via the `ort rc.12` already in the graph — but
   that still requires writing the fbank/LFR/CMVN frontend from blocker #1.

Cost/benefit note:

- FSMN-VAD's main draw is Chinese / ASR-style sensitivity, but the existing fixture data shows TEN
  (and FireRed) already cover that gap where Silero fails — e.g. Japanese `小陈.wav`: Silero
  `16.8%` vs TEN `73.2%` / FireRed `67.9%`. Combined with FSMN's recall bias (risk of inflating
  dialogue loudness on vocal music / noise), the cost of building a bespoke frontend is hard to
  justify until a concrete case appears that TEN/FireRed demonstrably cannot handle.

If revisited, the only acceptable mainline path:

- ONNX/runtime-only via the existing `ort rc.12` (no Python, no GPL crate).
- Vendor the FSMN-VAD onnx + `am.mvn` + the FunASR Model License under `src-tauri/vendor/funasr-vad/`,
  mirroring the TEN vendoring pattern.
- Implement and unit-test the fbank + LFR + CMVN frontend and FSMN streaming chunk inference
  separately from `speech.rs`'s uniform chunk loop, then reduce to per-100 ms block decisions for
  the shared `VadBlockAggregator`.
- Trigger condition for revisiting: a specific Chinese/segmentation case that TEN and FireRed
  measurably fail on.

Original spike checklist (kept for reference):

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

Initial fixture comparison:

- A temporary local comparison runner was used for the first spike and then removed from the
  product crate after it interfered with Windows bundling.
- On the existing synthetic fixtures, Silero, FireRed, and TEN were close:
  - `speech_pure`: Silero `89.4%`, FireRed `86.1%`, TEN `87.0%`
  - `noise_pure`: Silero `0.0%`, FireRed `0.0%`, TEN `0.0%`
  - `mix_5050`: Silero `44.5%`, FireRed `43.5%`, TEN `43.7%`
  - `mix_2080`: Silero `18.5%`, FireRed `17.8%`, TEN `18.1%`
- On `小陈.wav` (Japanese speech), Silero under-detects heavily: Silero `16.8%`,
  FireRed `67.9%`, TEN `73.2%`.
- On dialogue-like recordings, TEN is currently the most sensitive of the three:
  - `vo test.wav`: Silero `78.0%`, FireRed `82.9%`, TEN `86.0%`
  - `佩丽卡.wav`: Silero `78.4%`, FireRed `83.0%`, TEN `86.3%`
- On vocal music, FireRed and TEN are much more sensitive than Silero, which is useful evidence but
  also a warning for dialogue loudness:
  - `Midnight Highway Heartbeat - Vocal A.wav`: Silero `5.3%`, FireRed `77.7%`, TEN `68.0%`
  - `Velvet in the Afternoon - Vocal A.wav`: Silero `47.2%`, FireRed `67.6%`, TEN `61.3%`
