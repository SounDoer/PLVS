# Dialogue-Gated Loudness — design

**Date:** 2026-06-12
**Status:** Draft
**Phase:** 1 of 1 (with a de-risking spike, Slice 0)

## Overview

Add a **dialogue-gated** loudness measurement mode, modelled on Youlean Loudness Meter's
"Dialog" readouts. On top of the existing BS.1770 energy gate, a voice-activity detector (VAD)
classifies which audio is speech, and a parallel integrator measures loudness **only over the
speech portions** of the program. This produces four new real-time readouts (UI labels):

- **Dialogue Coverage** — fraction of audible program time classified as speech.
- **Dialogue Integrated** — integrated loudness computed over speech-only blocks.
- **Dialogue Range (LRA)** — loudness range computed over speech-only blocks.
- **Dialogue Offset** — `Dialogue Integrated − Integrated`; how far dialogue sits above (+) or below
  (−) the overall program loudness. Derived on the frontend, not a backend value.

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

- Four real-time dialogue readouts — Dialogue Coverage, Dialogue Integrated, Dialogue Range (LRA),
  and Dialogue Offset — available as selectable rows in the loudness stats list, alongside (not
  replacing) the existing readouts. There is no separate on/off toggle; showing any dialogue readout
  drives the sidechain (see Gating control).
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
5. **No separate toggle — visibility-driven gating:** there is no dedicated on/off control. The VAD
   runs only while at least one dialogue readout is shown in the stats list (off by default). The
   existing stats-visibility selector is the control.
6. **Four readouts:** Dialogue Coverage (`%`), Dialogue Integrated (`LUFS`), Dialogue Range (LRA)
   (`LU`), Dialogue Offset (`LU`), in that order, as plain selectable rows (no section header).
   Dialogue Offset = `Dialogue Integrated − Integrated`, frontend-derived, shown with an explicit
   sign (+ = dialogue louder/more prominent than the program). A live "speaking now" dot sits on the
   Dialogue Coverage row.

## Architecture

A VAD sidechain runs in parallel to the existing loudness path. `LoudnessMeter::push_pcm` feeds it
continuously and, at each 100 ms block close, folds the block's speech verdict into a dialogue
accumulator.

```
LoudnessMeter::push_pcm(ctx)
  ├─ if dialogue_gating: SpeechDetector.push_mono(downmix(interleaved))   // continuous feed
  │     downmix→mono → resample to 16 kHz (rubato) → buffer 512-sample chunks
  │     → Silero per chunk → threshold 0.5 → BlockVote.record(is_speech)
  ├─ existing loudness path → every 100 ms closes a block: push [m0,m1] to ibl, compute short_term
  └─ on block close, if dialogue_gating:
        ms = ibl.last();  is_speech = SpeechDetector.take_block_decision()  // majority vote
        DialogueIntegrator.push_block(ms, short_term, is_speech)
        block.{dialogue_integrated, dialogue_lra, dialogue_percent} = DialogueIntegrator.{...}
```

### Component ownership (as built in Slice 1)

Three focused, independently-testable units rather than one merged struct:

- **`dsp::speech`** — `downmix_to_mono` (pure), `BlockVote` (per-block majority, pure), and
  `SpeechDetector` (owns the Silero session + `rubato` resampler + sample buffers + the current
  block's `BlockVote`). Exposes `push_mono(&[f32])` and `take_block_decision() -> bool`.
- **`dsp::dialogue`** — `DialogueIntegrator`: holds speech-only mean-square blocks, speech-time
  short-term values, and audible/speech block counts. Exposes `push_block(ms, short_term, is_speech)`
  plus `integrated()` / `lra()` / `percent()`.
- **`LoudnessMeter`** owns `Option<SpeechDetector>` (lazily built on first gated push) and a
  `DialogueIntegrator`, and wires them together in `push_pcm` as above.

The dialogue readouts reuse the main path's BS.1770 gate math via the shared free functions
`gated_integrated_lufs(&[[f64;2]])` and `gated_lra(&[f64])` (extracted from `LoudnessMeter` in
Slice 1; the existing `integrated()` / `lra()` now delegate to them). Dialogue % =
`speech_gated / gated_total` (both counted only over blocks above the −70 LUFS gate, so head/tail
silence does not dilute it).

### Resampler / chunking detail

- Silero v5 at 16 kHz consumes **fixed 512-sample (32 ms) chunks** and is stateful; chunks must be
  fed in order.
- 48 kHz → 16 kHz is exactly 3:1, but capture may run at other rates, so use `rubato` for a correct
  anti-aliased resample rather than naive decimation.
- The resampler output is buffered; whenever ≥ 512 samples are available, one chunk is run through
  Silero, yielding one speech probability thresholded at **0.5** (configurable constant).
- Each 100 ms loudness block tallies how many of its chunks were speech and applies the majority vote
  at block close.

## Gating control (visibility-driven, no separate toggle)

There is **no dedicated on/off toggle**. The existing stats-visibility selector is the control: the
VAD sidechain runs only while at least one dialogue readout is shown in the loudness stats list.
Dialogue rows are off by default, so the model neither loads nor runs until the user opts in by
adding a dialogue readout.

Rationale: the VAD cost is small (~1–4 % of one CPU core plus a one-time ~tens-of-ms model load,
based on Slice 0 numbers — Silero ≈ 0.6 % of a core, the `rubato` sinc resample is the larger share),
but loading a multi-MB model and holding it resident for users who never look at dialogue is still
waste. Tying it to visibility keeps it free when unused and costs nothing extra to wire (the flag was
going to be plumbed anyway).

Mechanics (reuses the `set_loudness_weights` live-config pattern):

- Frontend derives `dialogueGating = loudnessStatsVisibleIds` contains any dialogue metric id.
- `AppState` gains `dialogue_gating_enabled: Arc<Mutex<bool>>` (default `false`).
- IPC command `set_dialogue_gating(enabled: bool)` mirrors `set_loudness_weights`; the frontend
  sends it on engine start and whenever the derived value changes.
- The capture worker passes it into `PcmContext.dialogue_gating` (already added in Slice 1).
- When the flag flips, `MeterPipeline` resets **only** the dialogue accumulators and the speech
  detector's buffers/votes — not the main loudness state — so re-enabling starts clean and the two
  integrators stay independent. (This re-introduces `DialogueIntegrator::reset` and a
  `SpeechDetector` buffer reset, removed in Slice 1 as unused; Slice 2 adds them back with a test.)

When the flag is false the sidechain does not run and the dialogue fields report `None`.

## IPC contract

Extend the existing payloads rather than adding a new event stream.

`LoudnessBlock` (`src-tauri/src/dsp/loudness.rs`) — **already added in Slice 1**:

```rust
pub dialogue_integrated: f64,   // NEG_INFINITY when gating off or no speech yet
pub dialogue_lra: f64,          // 0.0 when gating off or insufficient speech
pub dialogue_percent: f64,      // 0.0..=100.0
```

`LoudnessSlowPayload` (~2 Hz `loudness-slow`) gains the three cumulative stats (camelCase, `Option`,
skipped when gating off):

```rust
pub dialogue_integrated: Option<f64>,
pub dialogue_lra: Option<f64>,
pub dialogue_percent: Option<f64>,
```

`AudioFramePayload` (~60 Hz frame stream) gains one field for the live speech indicator:

```rust
pub dialogue_active_now: bool,  // current 100ms block's speech verdict; false when gating off
```

**Dialogue Offset is not a payload field** — it is derived on the frontend as
`dialogue_integrated − integrated` (zero backend cost).

## Frontend

Four selectable readouts, defined alongside the existing metrics in
`src/hooks/useLoudnessHistory.js` and rendered by `LoudnessStatsPanel`
(`src/components/panels/LoudnessStatsPanel.jsx`). They are ordinary rows in the configurable stats
list (no section header/divider), **off by default**, in this order:

| order | id | label | unit | source |
| --- | --- | --- | --- | --- |
| 1 | `dialogueCoverage` | `Dialogue Coverage` | `%` | `dialogue_percent` |
| 2 | `dialogueIntegrated` | `Dialogue Integrated` | `LUFS` | `dialogue_integrated` |
| 3 | `dialogueRange` | `Dialogue Range (LRA)` | `LU` | `dialogue_lra` |
| 4 | `dialogueOffset` | `Dialogue Offset` | `LU` | `dialogue_integrated − integrated` |

- **Dialogue Coverage** is the cumulative speech share; em-dash until any audible block is seen.
- **Dialogue Integrated** is the dialogue-gated integrated loudness; em-dash until speech is detected.
- **Dialogue Range (LRA)** parallels the existing `Loudness Range (LRA)` row.
- **Dialogue Offset** = `Dialogue Integrated − Integrated`, shown **with an explicit sign**
  (`+2.3` / `−4.0`). Positive ⇒ dialogue stands out above the mix; negative ⇒ dialogue sits below it.
  Em-dash when either operand is not finite.
- **Live speech indicator:** a small dot on the **Dialogue Coverage** row, lit when
  `dialogue_active_now` is true (speaking right now), dim otherwise. Cumulative `%` and the live dot
  form a static/live pair. The dot only exists while the Coverage row is shown.
- **Caveat surfacing:** the known "singing counts as speech" limitation is conveyed via the existing
  metering footnote/hint mechanism (`src/math/meteringFootnoteHints.js`) on the dialogue rows, not a
  Settings notice.

Because the rows are off by default and drive `dialogueGating`, a fresh install runs no VAD until the
user adds a dialogue readout.

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

- If the model fails to load (`SpeechDetector::new` returns `None`): log once, leave the dialogue
  fields at their defaults, and run the meter normally. Dialogue rows show em-dash.
- Resampler or VAD errors on a chunk: skip that chunk's contribution; never panic the capture thread.
- `reset()` / Clear: dialogue accumulators, resampler state, chunk buffer, and vote counters all
  reset together with the rest of `LoudnessMeter` (`reset` recreates it via `new`).

## Testing

Rust — Slice 1 (DONE):

- `downmix_to_mono` averages channels per frame.
- `BlockVote` majority logic (≥ half speech → speech; empty → not speech).
- `DialogueIntegrator`: percent = speech / audible blocks, silent blocks excluded from the
  denominator; integrated measures only speech blocks (a louder non-speech block does not pull it up);
  LRA reflects only the speech short-term spread.
- End-to-end smoke: silence and a pure tone flow through downmix→resample→Silero→vote without
  panicking and are not classified as dialogue.

Rust — Slice 2 (to add):

- Flipping `dialogue_gating` off then on resets the dialogue accumulators and the speech detector's
  buffers/votes, without disturbing the main loudness state.
- `LoudnessSlowPayload` / `AudioFramePayload` carry the dialogue fields only when gating is on.
- IPC `set_dialogue_gating` accepts the bool and updates shared state.

Frontend — Slice 2:

- `dialogueGating` is derived true iff `loudnessStatsVisibleIds` contains a dialogue metric id, and
  `setDialogueGating` is invoked on start and on change.
- The four dialogue rows render with correct labels/units/order; values show em-dash before data.
- `Dialogue Offset` computes `dialogueIntegrated − integrated` with an explicit sign and em-dashes
  when either operand is non-finite.
- The live dot on the Coverage row reflects `dialogue_active_now`.

## Manual verification

1. Add a dialogue readout in the stats selector → the VAD starts; play a dialogue-heavy clip →
   Dialogue Integrated converges near the speech loudness and Dialogue Coverage is high.
2. Play music-only → Coverage drops; Dialogue Integrated reflects little/no speech (note the known
   singing-counts-as-speech caveat if vocals are present).
3. Confirm the Coverage live dot lights during speech and dims during silence/music.
4. Silence → no divide-by-zero; readouts stay at em-dash / 0 %.
5. Remove all dialogue readouts → the VAD stops (CPU returns to baseline); other readouts unchanged.
6. Clear → dialogue accumulators reset alongside the main meter.

## Slices

- **Slice 0 — packaging spike (DONE, Windows):** added `voice_activity_detector`, ran one inference,
  confirmed static linking with zero bundled resources. De-risked. See Packaging.
- **Slice 1 — DSP sidechain (DONE):** `downmix_to_mono`, `BlockVote`, `SpeechDetector`
  (rubato + Silero), and `DialogueIntegrator` wired into `LoudnessMeter` behind
  `PcmContext.dialogue_gating`; `LoudnessBlock` carries the three dialogue fields. Unit + smoke tests.
- **Slice 2 — IPC + UI:** visibility-driven `set_dialogue_gating`; extend `LoudnessSlowPayload`
  (3 stats) and `AudioFramePayload` (`dialogue_active_now`); add the four readouts + Coverage live dot
  to `LoudnessStatsPanel`; reset dialogue state on gating flip.

## Implementation-time tuning (not design blockers)

1. **VAD threshold + smoothing constants:** start with default speech probability 0.5 and Silero's
   default min-speech / min-silence smoothing; calibrate against real material (film, podcast, music)
   in Slice 1. These are tuning constants, not architectural decisions.

## Pending sign-off (not blocking work)

- **macOS verified-runnable bundle** — pending access to a Mac. Config is written to match documented
  practice; the actual build/run check happens when a Mac is available. See "macOS support" above.
