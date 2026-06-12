# Dialogue-Gated Loudness — design

**Date:** 2026-06-12
**Status:** Draft
**Phase:** 1 of 1 (with a de-risking spike, Slice 0)

## Overview

Add a **dialogue-gated** loudness measurement mode, modelled on Youlean Loudness Meter's
"Dialog" readouts. On top of the existing BS.1770 energy gate, a voice-activity detector (VAD)
classifies which audio is speech, and a parallel integrator measures loudness **only over the
speech portions** of the program. This produces three new real-time readouts:

- **Dialogue Integrated** — integrated loudness computed over speech-only blocks.
- **Dialogue LRA** — loudness range computed over speech-only blocks.
- **Dialogue %** — fraction of measured program time classified as speech.

The detector is [Silero VAD](https://github.com/snakers4/silero-vad) (MIT), run via the
`voice_activity_detector` Rust crate on top of the `ort` ONNX Runtime bindings.

This is a **monitoring** feature. It is explicitly **not** a standards-compliant dialogue
measurement (see Non-goals).

## Background / why Silero, not Dolby

Youlean's Dialog feature uses **Dolby Dialogue Intelligence™** plus custom code. Dolby's
detector is patented and license-gated, so it is not an option for an independent MIT project.
Silero VAD is the realistic open alternative: ~2 MB model, runs at 16 kHz, <1 ms per chunk on
one CPU thread, MIT-licensed, with existing Rust bindings. It is behaviourally similar but not
bit-identical to Dolby — expect a few tenths to ~1 dB difference on dialogue loudness, and note
that Silero does **not** distinguish speech from singing (music vocals will count as dialogue).

## Current state

- `MeterPipeline::push_pcm_f32` (`src-tauri/src/engine/meter_pipeline.rs`) is the PCM intake; it
  already receives `interleaved`, `channels`, and a `sample_rate` (from `MeterPipeline::new`).
- `LoudnessMeter` (`src-tauri/src/dsp/loudness.rs`) accumulates one K-weighted mean-square block
  every 100 ms into `self.ibl`, and `integrated()` / `lra()` apply the −70 LUFS absolute gate and
  −10 LU relative gate over that buffer.
- Meters implement a shared `Meter` trait with a `PcmContext` (`src-tauri/src/dsp/meter.rs`).
- IPC payloads `AudioFramePayload` and `LoudnessSlowPayload` (`src-tauri/src/ipc/types.rs`) already
  carry integrated / LRA values to the frontend.
- `AppState` already holds shared config such as `loudness_weights: Arc<Mutex<Option<Vec<f64>>>>`
  and there is an established pattern for IPC commands that mutate engine config live
  (`set_loudness_weights` in `src-tauri/src/ipc/commands.rs`).
- Tauri bundling (`src-tauri/tauri.conf.json`) currently lists only tray icons under `resources`.

The missing pieces are: a VAD sidechain, a speech-gated integrator, the three new readouts on the
IPC + UI, and ONNX Runtime packaging.

## Goals

- A user-toggleable dialogue-gated mode produces Dialogue Integrated, Dialogue LRA, and Dialogue %
  in real time, alongside (not replacing) the existing integrated/LRA values.
- Speech detection uses Silero VAD on a mono, 16 kHz downmix of the input.
- Speech gating is layered on top of the existing −70/−10 BS.1770 gates: a block must be both
  speech-classified **and** pass the energy gates to count toward dialogue loudness.
- The feature degrades safely: if the VAD/model is unavailable, dialogue readouts report "n/a" and
  the rest of the meter is unaffected.
- ONNX Runtime is **statically linked** into the app binary via `ort`'s default download strategy;
  no runtime library or model file is shipped as a separate resource (validated in Slice 0).

## Non-goals

- **Not** a standards-compliant measurement. No claim of ATSC A/85, CALM Act, or Netflix
  compliance; UI must not imply it.
- No Dolby Dialogue Intelligence integration.
- No speech-vs-singing discrimination.
- No per-channel or center-channel-only dialogue heuristic (we downmix all channels — see Decisions).
- No offline/file-analysis mode; this is the live loopback meter only.
- No change to existing momentary / short-term / integrated / true-peak / spectrum / vectorscope
  behaviour.

## Decisions (locked)

1. **Downmix:** all input channels are summed/averaged to a single mono signal before the VAD.
   (Not center-channel-only.)
2. **Block aggregation:** a 100 ms loudness block spans ~3 Silero chunks (32 ms each). The block is
   classified **speech** by **majority vote** of its chunks (≥ half are speech). Silero's built-in
   min-speech / min-silence smoothing handles within-word gaps; majority vote stabilises the
   100 ms bucket.
3. **Packaging:** `ort` default download strategy, which **statically links** ONNX Runtime into the
   app binary. Nothing is shipped as a separate resource — no `onnxruntime.dll`/`.dylib`, no model
   file (the Silero model is embedded in the `voice_activity_detector` crate). _Revised from the
   original `load-dynamic` plan after Slice 0 proved static linking works with zero bundling on
   Windows — strictly simpler and no runtime dll-path resolution._
4. **Dialogue % denominator:** speech blocks divided by **energy-gated blocks** (blocks that pass the
   −70 LUFS absolute gate). Leading/trailing/idle silence does not dilute the percentage, so the
   readout reflects current content rather than wall-clock idle time.

## Architecture

A VAD sidechain runs in parallel to the existing loudness path, producing a per-100ms-block speech
flag that gates a second integrator inside `LoudnessMeter`.

```
push_pcm_f32(interleaved, channels, sample_rate, ...)
  ├─ loudness.push_pcm(ctx)          // existing, unchanged
  │     └─ every 100ms: push [m0,m1] to ibl  (energy-gated integrated)
  │                     push speech-block?    → ibl_dialogue  (NEW)
  ├─ dialogue VAD sidechain (NEW)
  │     downmix→mono → resample 48k→16k (rubato) → buffer into 512-sample
  │     chunks → Silero → per-chunk speech prob → per-100ms majority vote
  └─ feed the block's speech flag into LoudnessMeter's dialogue integrator
```

### Component ownership

The VAD sidechain is **owned by `LoudnessMeter`** (not a separate `Meter`), because the speech flag
and the loudness block share the exact same 100 ms boundary and accumulation lifecycle. Keeping them
in one struct avoids re-deriving block boundaries and avoids a second copy of the gating logic.

Concretely, `LoudnessMeter` gains:

- a downmix + `rubato` resampler (48 kHz → 16 kHz), stateful, reset with the meter;
- a 16 kHz sample buffer that emits fixed 512-sample chunks to Silero;
- a Silero VAD session (shared/loaded once; see Packaging);
- per-100ms-block chunk vote counters;
- `ibl_dialogue: Vec<[f64; 2]>` — speech-only mean-square blocks;
- a speech-block counter and total-block counter for Dialogue %.

`integrated_dialogue()` and `lra_dialogue()` reuse the existing −70/−10 gate math over
`ibl_dialogue`. Dialogue % = `speech_blocks / total_blocks` (both counted only over blocks that
pass the −70 LUFS absolute gate, so silence at head/tail does not dilute the ratio).

### Resampler / chunking detail

- Silero v5 at 16 kHz consumes **fixed 512-sample (32 ms) chunks** and is stateful; chunks must be
  fed in order.
- 48 kHz → 16 kHz is exactly 3:1, but capture may run at other rates, so use `rubato` for a correct
  anti-aliased resample rather than naive decimation.
- The resampler output is buffered; whenever ≥ 512 samples are available, one chunk is run through
  Silero, yielding one speech probability thresholded at **0.5** (configurable constant).
- Each 100 ms loudness block tallies how many of its chunks were speech and applies the majority vote
  at block close.

## Mode toggle & state

Dialogue gating is opt-in (it costs CPU and loads a model). Follow the existing live-config pattern:

- `AppState` gains `dialogue_gating_enabled: Arc<Mutex<bool>>` (default `false`).
- New IPC command `set_dialogue_gating(enabled: bool)` mirrors `set_loudness_weights`.
- Frontend wrapper `setDialogueGating(enabled)` invokes it; the setting persists via the existing
  settings store and is sent on engine start, like other engine config.
- The capture worker reads a cloned snapshot per chunk and passes it into `PcmContext`
  (`pub dialogue_gating: bool`).
- When enabled flips, `MeterPipeline` resets only the dialogue accumulators (not the main loudness
  state), so the two integrators stay independent.

When disabled, the VAD sidechain does not run and the three dialogue fields report `None`.

## IPC contract

Extend the existing payloads rather than adding a new event stream.

`LoudnessBlock` (`src-tauri/src/dsp/loudness.rs`) gains:

```rust
pub dialogue_integrated: f64,   // NEG_INFINITY when no speech blocks yet
pub dialogue_lra: f64,          // 0.0 when insufficient speech blocks
pub dialogue_percent: f64,      // 0.0..=100.0
```

`LoudnessSlowPayload` gains (camelCase, `Option`, skipped when `None`/disabled):

```rust
pub dialogue_integrated: Option<f64>,
pub dialogue_lra: Option<f64>,
pub dialogue_percent: Option<f64>,
```

These three are emitted on the existing ~2 Hz `loudness-slow` channel — dialogue values are slow
statistics, so they do not need the 60 Hz frame payload. (If the UI wants a live "speech now"
indicator later, that can be added to `AudioFramePayload` separately; out of scope here.)

## Frontend

- A toggle in Settings: **"Dialogue-gated loudness"** (off by default), with a one-line caveat that
  it is a monitoring estimate (Silero VAD), not a certified dialogue measurement.
- `LoudnessStatsPanel` (`src/components/panels/LoudnessStatsPanel.jsx`) shows the three readouts when
  the mode is on:
  - `Dialog Integrated` in LUFS (em-dash when no speech detected yet),
  - `Dialog LRA` in LU,
  - `Dialog %` as a percentage.
- When the mode is off, the rows are hidden (not shown as zeros).

## Packaging (Slice 0 — DONE on Windows)

This was the highest-risk item. Slice 0 validated it and the result simplified the plan.

- Add only `voice_activity_detector = "0.2.1"` to `src-tauri/Cargo.toml`. It transitively pulls
  `ort =2.0.0-rc.10` and embeds the Silero model, so **no `ort` entry, no model file, and no
  `tauri.conf.json` resource changes are needed**.
- `ort`'s default download strategy **statically links** ONNX Runtime into the binary at build time
  (build machine needs network once to download the prebuilt runtime).
- **Slice 0 result (verified):** compiles and links against the project toolchain (rustc 1.95) and
  the full Tauri dependency tree; the bundled Silero model loads and runs inference; and the test
  binary runs from a directory containing only the executable (zero sibling DLLs) — proving nothing
  extra needs to be shipped. No `ORT_DYLIB_PATH`, no `load-dynamic`, no resource bundling.
- **Cost:** the binary grows by the static ONNX Runtime core (tens of MB). Build requires network to
  fetch the prebuilt runtime the first time.

### macOS support

macOS is a required target; the code and the static-linking approach are cross-platform. The only
macOS item that **cannot be verified from a Windows dev machine** is "a macOS bundle actually builds
and runs the statically-linked runtime" — that requires compiling and launching on a Mac. No Mac is
available right now, so:

- `ort`'s default strategy is expected to static-link a prebuilt macOS ONNX Runtime the same way;
  no resource bundling is anticipated.
- The "verified runnable on macOS" check is pending a Mac. This blocks *sign-off* of macOS, not the
  feature work; Windows is validated now.

## Failure / degradation behavior

- If the runtime library or model fails to load: log once, leave `dialogue_*` as `None`, and run the
  meter normally. The toggle may show a disabled/"unavailable" state.
- Resampler or VAD errors on a chunk: skip that chunk's contribution; never panic the capture thread.
- `reset()` / Clear: dialogue accumulators, resampler state, chunk buffer, and vote counters all
  reset together with the rest of `LoudnessMeter`.

## Testing

Rust:

- Downmix + resample produces 16 kHz mono of expected length from N-channel 48 kHz input.
- A speech-like signal (or a recorded clip fixture) yields majority-speech blocks; a pure tone /
  music-like signal yields low Dialogue %.
- `integrated_dialogue()` over a buffer of known speech blocks matches `integrated()` computed over
  the same blocks in isolation (gating math reuse is correct).
- Dialogue % counts speech blocks / energy-gated total blocks correctly, including the empty case
  (0 blocks → 0%, no divide-by-zero).
- Toggling `dialogue_gating` off stops populating dialogue fields and does not affect main loudness.
- Model-unavailable path: meter still produces normal blocks; dialogue fields are `None`.

Frontend:

- `setDialogueGating` invokes the Tauri command and persists the setting.
- `LoudnessStatsPanel` renders the three rows only when enabled; em-dash when no speech yet.

## Manual verification

1. Enable the toggle; play a dialogue-heavy clip → Dialogue Integrated converges near the program's
   speech loudness; Dialogue % is high.
2. Play music-only → Dialogue % drops; Dialogue Integrated reflects little/no speech (note the known
   singing-counts-as-speech caveat if vocals are present).
3. Silence → no divide-by-zero; readouts stay at em-dash / 0%.
4. Toggle off → dialogue rows disappear; integrated/LRA unchanged.
5. Clear → dialogue accumulators reset alongside the main meter.

## Slices

- **Slice 0 — packaging spike (DONE, Windows):** added `voice_activity_detector`, ran one inference,
  confirmed static linking with zero bundled resources. De-risked. See Packaging.
- **Slice 1 — DSP sidechain:** downmix + `rubato` + Silero + dialogue integrators in `LoudnessMeter`,
  behind the `dialogue_gating` flag, with Rust tests.
- **Slice 2 — IPC + UI:** extend payloads, add the toggle and the three readouts to
  `LoudnessStatsPanel`.

## Implementation-time tuning (not design blockers)

1. **VAD threshold + smoothing constants:** start with default speech probability 0.5 and Silero's
   default min-speech / min-silence smoothing; calibrate against real material (film, podcast, music)
   in Slice 1. These are tuning constants, not architectural decisions.

## Pending sign-off (not blocking work)

- **macOS verified-runnable bundle** — pending access to a Mac. Config is written to match documented
  practice; the actual build/run check happens when a Mac is available. See "macOS support" above.
