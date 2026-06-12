# Dialogue-Gated Loudness — Slice 2 (IPC + UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the four dialogue-gated readouts (Coverage, Integrated, Range (LRA), Offset) in the loudness stats list with a live "speaking now" dot, driving the VAD sidechain on/off from whether any dialogue readout is shown.

**Architecture:** Backend already computes dialogue values (Slice 1, `LoudnessBlock.dialogue_*`). This slice (A) threads a `dialogue_gating: Arc<Mutex<bool>>` flag through the same chain as `loudness_weights`, resets dialogue state when it flips, and extends the IPC payloads; then (B) the frontend derives the flag from stats-row visibility, maps the new payload fields into `displayAudio`, and renders the four rows + live dot.

**Tech Stack:** Rust (Tauri commands, cpal/macOS capture backends, `serde`), React (hooks, Vitest/RTL).

**Spec:** `docs/superpowers/specs/2026-06-12-dialogue-gated-loudness-design.md`

---

## File Structure

Backend (Rust):
- `src-tauri/src/state.rs` — add `dialogue_gating_enabled: Arc<Mutex<bool>>`.
- `src-tauri/src/ipc/commands.rs` — add `set_dialogue_gating` command; thread the flag in `audio_start`.
- `src-tauri/src/lib.rs` — register the new command in the invoke handler.
- `src-tauri/src/audio/capture.rs` — add the flag to the `AudioCapture::start_session` trait.
- `src-tauri/src/audio/cpal_backend.rs` — thread through `start_session` / `CaptureSession::start` / `RunCaptureArgs` / worker loop.
- `src-tauri/src/audio/platform_backend.rs` + `src-tauri/src/audio/macos/mod.rs` — thread through the macOS dispatch + backend (cfg(macos); compiles but unverifiable on Windows).
- `src-tauri/src/engine/meter_pipeline.rs` — accept the flag in `push_pcm_f32`, reset dialogue state on flip, populate payload fields.
- `src-tauri/src/dsp/dialogue.rs` + `src-tauri/src/dsp/speech.rs` — re-add `reset()` used by the flip path.
- `src-tauri/src/dsp/loudness.rs` — expose dialogue reset hook on `LoudnessMeter`.
- `src-tauri/src/ipc/types.rs` — extend `LoudnessSlowPayload` (3 stats) and `AudioFramePayload` (`dialogue_active_now`).

Frontend (JS):
- `src/ipc/commands.js` — add `setDialogueGating(enabled)` wrapper.
- `src/hooks/useAudioEngine.js` — map dialogue payload fields into the live audio object; send the flag on start.
- `src/lib/panelControls.js` — add the four dialogue ids to `LOUDNESS_STATS_OPTIONS` (NOT to defaults).
- `src/hooks/useLoudnessHistory.js` — define the four metric rows incl. signed Offset.
- `src/App.jsx` — derive `dialogueGating` from visible ids and push it via an effect.
- `src/components/panels/LoudnessStatsPanel.jsx` — render the live dot on the Coverage row.
- `src/math/meteringFootnoteHints.js` — add the singing caveat hint.

---

## PART A — BACKEND

### Task A1: `set_dialogue_gating` command + AppState flag

**Files:**
- Modify: `src-tauri/src/state.rs:18` (struct), `:28` (init)
- Modify: `src-tauri/src/ipc/commands.rs` (new command near `set_loudness_weights:179`)
- Modify: `src-tauri/src/lib.rs:34` (invoke handler list)
- Test: `src-tauri/src/ipc/commands.rs` (tests module)

- [ ] **Step 1: Add the state field.** In `state.rs`, after the `loudness_weights` field (line 18) add:

```rust
  pub dialogue_gating_enabled: Arc<Mutex<bool>>,
```

and in the initializer (after line 28 `loudness_weights: Arc::new(Mutex::new(None)),`) add:

```rust
      dialogue_gating_enabled: Arc::new(Mutex::new(false)),
```

- [ ] **Step 2: Write the failing test** in the `tests` module of `commands.rs` (alongside the `loudness_weights_validation_*` tests):

```rust
  #[test]
  fn set_dialogue_gating_updates_shared_flag() {
    let flag = std::sync::Arc::new(std::sync::Mutex::new(false));
    super::apply_dialogue_gating(&flag, true);
    assert!(*flag.lock().unwrap());
    super::apply_dialogue_gating(&flag, false);
    assert!(!*flag.lock().unwrap());
  }
```

- [ ] **Step 3: Run test to verify it fails.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml set_dialogue_gating_updates_shared_flag`
Expected: FAIL — `apply_dialogue_gating` not found.

- [ ] **Step 4: Implement the helper + command.** In `commands.rs`, near `set_loudness_weights`:

```rust
pub(crate) fn apply_dialogue_gating(flag: &std::sync::Arc<std::sync::Mutex<bool>>, enabled: bool) {
  if let Ok(mut g) = flag.lock() {
    *g = enabled;
  }
}

#[tauri::command]
pub fn set_dialogue_gating(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
  apply_dialogue_gating(&state.inner().dialogue_gating_enabled, enabled);
  Ok(())
}
```

- [ ] **Step 5: Register the command.** In `lib.rs`, in the `tauri::generate_handler![...]` list, after `ipc::commands::set_loudness_weights,` (line 34) add:

```rust
      ipc::commands::set_dialogue_gating,
```

- [ ] **Step 6: Run test to verify it passes.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml set_dialogue_gating_updates_shared_flag`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src-tauri/src/state.rs src-tauri/src/ipc/commands.rs src-tauri/src/lib.rs
git commit -m "feat(ipc): add set_dialogue_gating command + shared flag"
```

### Task A2: Thread `dialogue_gating` through the capture chain into `push_pcm_f32`

This mirrors `loudness_weights` exactly. No isolated unit test — verified by compilation + existing tests. Add the parameter at each anchor below, in the SAME position (immediately after `loudness_weights`).

**Files:** `capture.rs`, `cpal_backend.rs`, `platform_backend.rs`, `macos/mod.rs`, `commands.rs`, `meter_pipeline.rs`.

- [ ] **Step 1: Trait.** `capture.rs:39` — after the `loudness_weights` param of `start_session` add:

```rust
    dialogue_gating: std::sync::Arc<std::sync::Mutex<bool>>,
```

- [ ] **Step 2: cpal backend.** In `cpal_backend.rs`, add a `dialogue_gating: Arc<std::sync::Mutex<bool>>` param/field/arg at each `loudness_weights` site: the `start_session` impl (`:53`, pass at `:62`), `CaptureSession::start` signature (`:96`) and its `RunCaptureArgs{...}` (`:123`), the `RunCaptureArgs` struct (`:150`), and the worker. In the worker loop, mirror the snapshot read at `:317` and the call at `:319`:

```rust
    let dialogue_gating = dialogue_gating.lock().map(|g| *g).unwrap_or(false);
    pipeline.push_pcm_f32(&floats, pair, layout, spectrum_sel, loudness_weights, dialogue_gating);
```

(Also pass `dialogue_gating` into `RunCaptureArgs` construction at `:402`/`:441` if present in that path.)

- [ ] **Step 3: macOS dispatch + backend.** Add the same param at each `loudness_weights` anchor in `platform_backend.rs` (`:38` sig, `:49` macos call, `:61` cpal call) and `macos/mod.rs` (`:156`, `:176`, `:257`, `:276`, `:296` pub fn sig `:303`, `:313`, `:316` cpal call `:323`). The macOS worker calls `push_pcm_f32` similarly — pass the snapshotted bool as the new last argument.

- [ ] **Step 4: audio_start.** In `commands.rs` `audio_start`, after `let loudness_weights = state.inner().loudness_weights.clone();` (`:99`) add:

```rust
  let dialogue_gating = state.inner().dialogue_gating_enabled.clone();
```

and pass `dialogue_gating,` as the new last argument to `AudioCapture::start_session(...)` (after `loudness_weights,` at `:108`).

- [ ] **Step 5: meter_pipeline signature.** In `meter_pipeline.rs`, add to `push_pcm_f32` (`:142-148`) a final param:

```rust
    dialogue_gating: bool,
```

and in the `PcmContext { ... }` construction (`:189`) set:

```rust
      dialogue_gating,
```

(replace the hardcoded `dialogue_gating: false` added in Slice 1). Update the four `push_pcm_f32` test call sites in this file (`:485`, `:498`, `:519`, `:538`, `:674` area) to pass `false` as the new last argument.

- [ ] **Step 6: Build + existing tests.**

Run: `cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml --lib`
Expected: compiles; all existing tests PASS.

- [ ] **Step 7: Commit.**

```bash
git add src-tauri/src/audio src-tauri/src/ipc/commands.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(capture): thread dialogue_gating flag into push_pcm_f32"
```

### Task A3: Reset dialogue state when the gating flag flips

Re-add the `reset()` helpers removed in Slice 1 and call them from `MeterPipeline` only when the flag changes.

**Files:** `src-tauri/src/dsp/speech.rs`, `src-tauri/src/dsp/dialogue.rs`, `src-tauri/src/dsp/loudness.rs`, `src-tauri/src/engine/meter_pipeline.rs`.

- [ ] **Step 1: Write the failing test** in `meter_pipeline.rs` tests:

```rust
  #[test]
  fn dialogue_percent_resets_when_gating_toggles_off_then_on() {
    let sr = 48_000_u32;
    let mut p = MeterPipeline::new(sr, 2);
    let frames = sr as usize / 10;
    let tone: Vec<f32> = (0..frames)
      .flat_map(|i| {
        let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr as f64).sin() as f32 * 0.5;
        [s, s]
      })
      .collect();
    // Gating on for a block, then off, then on again — the audible-block counter must restart.
    let _ = p.push_pcm_f32(&tone, (0, 1), ChannelLayoutSetting::Auto, SpectrumChannelSel::default(), None, true);
    let _ = p.push_pcm_f32(&tone, (0, 1), ChannelLayoutSetting::Auto, SpectrumChannelSel::default(), None, false);
    let (frame, _) = p.push_pcm_f32(&tone, (0, 1), ChannelLayoutSetting::Auto, SpectrumChannelSel::default(), None, true);
    let block = frame.expect("frame");
    // After a single audible block since re-enable, a non-speech tone yields 0% (not stale).
    assert_eq!(block.dialogue_percent, 0.0);
    assert!(!block.dialogue_integrated.is_finite());
  }
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml dialogue_percent_resets_when_gating_toggles`
Expected: FAIL (compile error: `push_pcm_f32` arity, or behavior mismatch once arity fixed).

- [ ] **Step 3: Re-add the reset helpers.** In `dialogue.rs`, inside `impl DialogueIntegrator` add:

```rust
  pub fn reset(&mut self) {
    *self = Self::new();
  }
```

In `speech.rs`, inside `impl SpeechDetector` add (clears buffers/votes; keeps the loaded model):

```rust
  pub fn reset(&mut self) {
    self.in_buf.clear();
    self.chunk_buf.clear();
    self.vote.reset();
    let _ = self.resampler.reset();
  }
```

(`use rubato::Resampler;` is already imported.)

- [ ] **Step 4: Expose a dialogue reset on `LoudnessMeter`.** In `loudness.rs` add:

```rust
  /// Reset only the dialogue accumulators + speech detector buffers (gating toggle), not main loudness.
  pub fn reset_dialogue(&mut self) {
    self.dialogue.reset();
    if let Some(det) = self.speech.as_mut() {
      det.reset();
    }
  }
```

- [ ] **Step 5: Track + apply the flip in `MeterPipeline`.** Add a `last_dialogue_gating: bool` field (init `false` in `new`). At the top of `push_pcm_f32`, before pushing PCM:

```rust
    if dialogue_gating != self.last_dialogue_gating {
      self.loudness.reset_dialogue();
      self.last_dialogue_gating = dialogue_gating;
    }
```

- [ ] **Step 6: Run to verify it passes.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml dialogue_percent_resets_when_gating_toggles`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add src-tauri/src/dsp src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(loudness): reset dialogue state when gating flag flips"
```

### Task A4: Carry dialogue stats on `LoudnessSlowPayload`

**Files:** `src-tauri/src/ipc/types.rs:121`, `src-tauri/src/engine/meter_pipeline.rs` (slow emit `:279`).

- [ ] **Step 1: Write the failing test** in `meter_pipeline.rs` tests — feed a tone with gating on and assert the slow payload exposes a dialogue field:

```rust
  #[test]
  fn slow_payload_reports_dialogue_when_gating_on() {
    let sr = 48_000_u32;
    let mut p = MeterPipeline::new(sr, 2);
    let frames = sr as usize / 10;
    let tone: Vec<f32> = (0..frames)
      .flat_map(|i| {
        let s = (2.0 * std::f64::consts::PI * 1000.0 * i as f64 / sr as f64).sin() as f32 * 0.5;
        [s, s]
      })
      .collect();
    // SLOW_EMIT_MS is 500ms; feed ~600ms to force a slow payload.
    let mut slow = None;
    for _ in 0..7 {
      let (_f, s) = p.push_pcm_f32(&tone, (0, 1), ChannelLayoutSetting::Auto, SpectrumChannelSel::default(), None, true);
      if s.is_some() { slow = s; }
    }
    let slow = slow.expect("slow payload");
    // Tone is audible but not speech → coverage Some(0.0).
    assert_eq!(slow.dialogue_percent, Some(0.0));
  }
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slow_payload_reports_dialogue_when_gating_on`
Expected: FAIL — `dialogue_percent` not a field of `LoudnessSlowPayload`.

- [ ] **Step 3: Extend the payload.** In `types.rs`, in `LoudnessSlowPayload` (after `plr` at `:129`) add:

```rust
  #[serde(skip_serializing_if = "Option::is_none")]
  pub dialogue_integrated: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub dialogue_lra: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub dialogue_percent: Option<f64>,
```

- [ ] **Step 4: Populate it.** In `meter_pipeline.rs` slow emit block (`:279` `slow_out = Some(LoudnessSlowPayload { ... })`), compute from `self.last_loudness` and `self.last_dialogue_gating`:

```rust
        let (dialogue_integrated, dialogue_lra, dialogue_percent) = if self.last_dialogue_gating {
          let l = self.last_loudness.as_ref();
          (
            l.map(|b| b.dialogue_integrated).filter(|v| v.is_finite()),
            l.map(|b| b.dialogue_lra),
            l.map(|b| b.dialogue_percent),
          )
        } else {
          (None, None, None)
        };
```

and add `dialogue_integrated, dialogue_lra, dialogue_percent,` to the `LoudnessSlowPayload { ... }` literal.

- [ ] **Step 5: Run to verify it passes.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml slow_payload_reports_dialogue_when_gating_on`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src-tauri/src/ipc/types.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(ipc): carry dialogue stats on LoudnessSlowPayload"
```

### Task A5: Carry `dialogue_active_now` on `AudioFramePayload`

**Files:** `src-tauri/src/ipc/types.rs:84`, `src-tauri/src/engine/meter_pipeline.rs` (frame assembly `:411`, and store the latest verdict).

- [ ] **Step 1: Write the failing test** in `meter_pipeline.rs` tests:

```rust
  #[test]
  fn frame_payload_has_dialogue_active_now_field_default_false() {
    let sr = 48_000_u32;
    let mut p = MeterPipeline::new(sr, 2);
    let frames = sr as usize / 10;
    let silence = vec![0.0_f32; frames * 2];
    let mut seen = false;
    for _ in 0..3 {
      if let (Some(f), _) = p.push_pcm_f32(&silence, (0, 1), ChannelLayoutSetting::Auto, SpectrumChannelSel::default(), None, true) {
        assert!(!f.dialogue_active_now);
        seen = true;
      }
    }
    assert!(seen, "a frame should be emitted");
  }
```

- [ ] **Step 2: Run to verify it fails.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml frame_payload_has_dialogue_active_now`
Expected: FAIL — `dialogue_active_now` missing.

- [ ] **Step 3: Extend the payload + track the verdict.** In `types.rs` `AudioFramePayload` (after `timestamp_ms` at `:108`) add:

```rust
  pub dialogue_active_now: bool,
```

Expose the latest per-block speech verdict from `LoudnessMeter` **without touching the four
`LoudnessBlock` construction sites**. In `loudness.rs`: add a `speech_now: bool` field to
`LoudnessMeter` (init `false` in `new`); in `push_pcm`, inside the existing Slice-1 `if
ctx.dialogue_gating { ... }` augmentation block, after computing `is_speech`, set
`self.speech_now = is_speech;` (and `self.speech_now = false;` in the `else`/gating-off path). Add:

```rust
  pub fn speech_now(&self) -> bool {
    self.speech_now
  }
```

In `meter_pipeline.rs`, add a `dialogue_active_now: bool` field to `MeterPipeline` (init `false` in
`new`). Where the block is applied (after `self.loudness.take_block()` / `apply_loudness_block`), set:

```rust
    self.dialogue_active_now = self.last_dialogue_gating && self.loudness.speech_now();
```

In the frame assembly literal (`:411`), add:

```rust
      dialogue_active_now: self.dialogue_active_now,
```

- [ ] **Step 4: Run to verify it passes.**

Run: `cargo test --manifest-path src-tauri/Cargo.toml frame_payload_has_dialogue_active_now`
Expected: PASS. Also run `cargo test --manifest-path src-tauri/Cargo.toml --lib` (all green).

- [ ] **Step 5: Commit.**

```bash
git add src-tauri/src/ipc/types.rs src-tauri/src/dsp/loudness.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(ipc): carry dialogue_active_now on AudioFramePayload"
```

---

## PART B — FRONTEND

### Task B1: `setDialogueGating` IPC wrapper

**Files:** `src/ipc/commands.js:61` (next to `setLoudnessWeights`); Test: `src/App.toolbar.test.js`.

- [ ] **Step 1: Write the failing test** (source-contains, matching the existing `setLoudnessWeights` assertion at `App.toolbar.test.js:26`):

```js
  it("exposes a setDialogueGating IPC wrapper", () => {
    expect(commandsSource).toContain("export function setDialogueGating(enabled)");
  });
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npm run test -- App.toolbar`
Expected: FAIL — string not found.

- [ ] **Step 3: Implement the wrapper** in `commands.js` after `setLoudnessWeights`:

```js
export function setDialogueGating(enabled) {
  return invoke("set_dialogue_gating", { enabled: !!enabled });
}
```

- [ ] **Step 4: Run to verify it passes.**

Run: `npm run test -- App.toolbar`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/ipc/commands.js src/App.toolbar.test.js
git commit -m "feat(ipc): add setDialogueGating frontend wrapper"
```

### Task B2: Map dialogue payload fields into the live audio object + send flag on start

**Files:** `src/hooks/useAudioEngine.js` (slow-payload mapping; the `setLoudnessWeights` send at `:155`). Inspect the existing slow-payload handler to mirror the camelCase mapping (`lufsIntegrated`, `lra`, etc.).

- [ ] **Step 1: Map the new fields.** Where the `loudness-slow` payload is folded into the live audio object, add (mirroring existing fields):

```js
      dialogueIntegrated: slow.dialogueIntegrated ?? -Infinity,
      dialogueLra: slow.dialogueLra ?? 0,
      dialoguePercent: slow.dialoguePercent ?? null,
```

and where the ~60 Hz frame payload is folded in, add:

```js
      dialogueActiveNow: !!frame.dialogueActiveNow,
```

- [ ] **Step 2: Send the flag on engine start.** Near the `setLoudnessWeights(...)` start call (`:155`), add a `setDialogueGating` import and send the current value from a ref:

```js
            await setDialogueGating(dialogueGatingRef?.current ?? false);
```

(Add `dialogueGatingRef` as a prop/param of the hook, mirroring `loudnessWeightsRef`.)

- [ ] **Step 3: Verify build.**

Run: `npm run build` (or `npm run test`) — no type/lint errors.
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add src/hooks/useAudioEngine.js
git commit -m "feat(audio): map dialogue payload fields into live audio + send flag on start"
```

### Task B3: Add the four dialogue ids to the stats options (off by default)

**Files:** `src/lib/panelControls.js:4` (`LOUDNESS_STATS_OPTIONS`); Test: `src/lib/panelControls.test.js`.

- [ ] **Step 1: Write the failing test** in `panelControls.test.js`:

```js
  it("offers the four dialogue stats options but excludes them from defaults", () => {
    const ids = LOUDNESS_STATS_OPTIONS.map((o) => o.id);
    expect(ids).toEqual(
      expect.arrayContaining(["dialogueCoverage", "dialogueIntegrated", "dialogueRange", "dialogueOffset"])
    );
    expect(DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds).not.toContain("dialogueCoverage");
  });
```

(Ensure `LOUDNESS_STATS_OPTIONS` and `DEFAULT_PANEL_CONTROLS` are imported in the test.)

- [ ] **Step 2: Run to verify it fails.**

Run: `npm run test -- panelControls`
Expected: FAIL.

- [ ] **Step 3: Add the options.** In `panelControls.js`, append to `LOUDNESS_STATS_OPTIONS` (after `plr`):

```js
  { id: "dialogueCoverage", label: "Dialogue Coverage" },
  { id: "dialogueIntegrated", label: "Dialogue Integrated" },
  { id: "dialogueRange", label: "Dialogue LRA" },
  { id: "dialogueOffset", label: "Dialogue Offset" },
```

Do NOT add them to `DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds` (off by default).

- [ ] **Step 4: Run to verify it passes.**

Run: `npm run test -- panelControls`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/lib/panelControls.js src/lib/panelControls.test.js
git commit -m "feat(ui): add dialogue stats options (off by default)"
```

### Task B4: Define the four dialogue metric rows (incl. signed Offset)

**Files:** `src/hooks/useLoudnessHistory.js` (`primaryMetrics` `:124`); Test: new `src/hooks/useLoudnessHistory.dialogue.test.js` or extend an existing metrics test.

- [ ] **Step 1: Write the failing test.** Create a small pure helper `dialogueOffsetText(dialogueIntegrated, integrated)` and test it:

```js
import { dialogueOffsetText } from "./useLoudnessHistory.js";

describe("dialogueOffsetText", () => {
  it("shows a signed LU value when both operands are finite", () => {
    expect(dialogueOffsetText(-22, -20)).toBe("-2.0");   // dialogue below program
    expect(dialogueOffsetText(-18, -20)).toBe("+2.0");   // dialogue stands out
  });
  it("shows em-dash when an operand is not finite", () => {
    expect(dialogueOffsetText(-Infinity, -20)).toBe("—");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npm run test -- useLoudnessHistory.dialogue`
Expected: FAIL — `dialogueOffsetText` not exported.

- [ ] **Step 3: Implement the helper + rows.** In `useLoudnessHistory.js` add (module scope, exported):

```js
export function dialogueOffsetText(dialogueIntegrated, integrated) {
  if (!Number.isFinite(dialogueIntegrated) || !Number.isFinite(integrated)) return "—";
  const d = dialogueIntegrated - integrated;
  return `${d >= 0 ? "+" : "-"}${Math.abs(d).toFixed(1)}`;
}
```

Append to the `primaryMetrics` array (after `lra`):

```js
      {
        id: "dialogueCoverage",
        label: "Dialogue Coverage",
        value: Number.isFinite(displayAudio.dialoguePercent)
          ? `${displayAudio.dialoguePercent.toFixed(0)}`
          : "—",
        unit: "%",
      },
      {
        id: "dialogueIntegrated",
        label: "Dialogue Integrated",
        value: fmtMetric(displayAudio.dialogueIntegrated),
        unit: "LUFS",
      },
      {
        id: "dialogueRange",
        label: "Dialogue Range (LRA)",
        value: fmtMetric(displayAudio.dialogueLra),
        unit: "LU",
      },
      {
        id: "dialogueOffset",
        label: "Dialogue Offset",
        value: dialogueOffsetText(displayAudio.dialogueIntegrated, displayAudio.integrated),
        unit: "LU",
      },
```

- [ ] **Step 4: Run to verify it passes.**

Run: `npm run test -- useLoudnessHistory.dialogue`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/hooks/useLoudnessHistory.js src/hooks/useLoudnessHistory.dialogue.test.js
git commit -m "feat(ui): add four dialogue metric rows with signed offset"
```

### Task B5: Derive `dialogueGating` from visible ids + push it via effect

**Files:** `src/App.jsx` (near the `setLoudnessWeights` effect `:304` and `loudnessStatsVisibleIds` at `:965`); Test: `src/App.toolbar.test.js` (source-contains).

- [ ] **Step 1: Write the failing test** in `App.toolbar.test.js`:

```js
  it("derives dialogue gating from visible dialogue stats ids", () => {
    expect(appSource).toContain("const DIALOGUE_STAT_IDS");
    expect(appSource).toContain("setDialogueGating(dialogueGating)");
  });
```

- [ ] **Step 2: Run to verify it fails.**

Run: `npm run test -- App.toolbar`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `App.jsx` add a module-level constant:

```js
const DIALOGUE_STAT_IDS = ["dialogueCoverage", "dialogueIntegrated", "dialogueRange", "dialogueOffset"];
```

Derive the flag from the normalized visible ids (where `loudnessStatsVisibleIds` is available, `:965`):

```js
  const dialogueGating = useMemo(
    () => normalizedPanelControls.loudnessStatsVisibleIds.some((id) => DIALOGUE_STAT_IDS.includes(id)),
    [normalizedPanelControls.loudnessStatsVisibleIds]
  );
```

Add an effect mirroring the `setLoudnessWeights` one (`:304`), only sending when running:

```js
  useEffect(() => {
    if (!running) return;
    setDialogueGating(dialogueGating).catch(() => {});
  }, [running, dialogueGating]);
```

Pass `dialogueGating` to `useAudioEngine` via a ref so it is also sent on start (Task B2 `dialogueGatingRef`).

- [ ] **Step 4: Run to verify it passes.**

Run: `npm run test -- App.toolbar`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/App.jsx src/App.toolbar.test.js
git commit -m "feat(ui): drive dialogue gating from stats-row visibility"
```

### Task B6: Live "speaking now" dot on the Coverage row

**Files:** `src/components/panels/LoudnessStatsPanel.jsx`; Test: `src/components/panels/LoudnessStatsPanel.test.jsx`.

- [ ] **Step 1: Write the failing test** (RTL) — when the Coverage metric is visible and `dialogueActiveNow` is true, a lit dot renders:

```jsx
  it("shows a lit speaking-now dot on the Dialogue Coverage row when active", () => {
    renderWithAudioData({
      primaryMetrics: [{ id: "dialogueCoverage", label: "Dialogue Coverage", value: "62", unit: "%" }],
      secondaryMetrics: [],
      loudnessStatsVisibleIds: ["dialogueCoverage"],
      dialogueActiveNow: true,
    });
    expect(screen.getByTestId("dialogue-active-dot")).toHaveAttribute("data-active", "true");
  });
```

(Match the existing `LoudnessStatsPanel.test.jsx` harness for providing `useAudioData` values; add `dialogueActiveNow` to that context.)

- [ ] **Step 2: Run to verify it fails.**

Run: `npm run test -- LoudnessStatsPanel`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `LoudnessStatsPanel.jsx`, read `dialogueActiveNow` from `useAudioData()`. In `MetricRow`, when `metric.id === "dialogueCoverage"`, render a small dot before the label:

```jsx
      {metric.id === "dialogueCoverage" && (
        <span
          data-testid="dialogue-active-dot"
          data-active={metric.active ? "true" : "false"}
          className={cn(
            "mr-1 inline-block h-2 w-2 shrink-0 rounded-full",
            metric.active ? "bg-[var(--ui-accent)]" : "bg-muted-foreground/30"
          )}
        />
      )}
```

Pass `active: dialogueActiveNow` onto the Coverage metric where rows are mapped (set `active` only for the `dialogueCoverage` row).

- [ ] **Step 4: Run to verify it passes.**

Run: `npm run test -- LoudnessStatsPanel`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/components/panels/LoudnessStatsPanel.jsx src/components/panels/LoudnessStatsPanel.test.jsx
git commit -m "feat(ui): live speaking-now dot on Dialogue Coverage row"
```

### Task B7: Singing-counts-as-speech footnote hint

**Files:** `src/math/meteringFootnoteHints.js`; Test: its existing test file if present, else a source-contains check.

- [ ] **Step 1: Inspect** `meteringFootnoteHints.js` to learn the hint shape (id → text mapping keyed by metric id).

- [ ] **Step 2: Write the failing test** asserting a dialogue hint exists for the dialogue rows (match the file's existing test style). Example (adjust to the real API):

```js
  it("hints that dialogue detection counts singing as speech", () => {
    const hint = footnoteHintFor("dialogueCoverage");
    expect(hint).toMatch(/singing|estimate|not certified/i);
  });
```

- [ ] **Step 3: Run to verify it fails**, then **add the hint** for the four dialogue ids:

```
"Dialogue detection is a Silero-VAD estimate (singing counts as speech); not a certified dialogue measurement."
```

- [ ] **Step 4: Run to verify it passes.**

Run: `npm run test -- meteringFootnoteHints`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/math/meteringFootnoteHints.js
git commit -m "feat(ui): footnote hint for dialogue VAD caveat"
```

---

## Final verification

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --lib` — all green.
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — clean.
- [ ] `npm run test` — all green.
- [ ] Manual (spec "Manual verification"): add a dialogue readout → VAD starts; play speech → Coverage high, Integrated converges, dot blinks with speech; play music → Coverage low; remove all dialogue rows → VAD stops; Clear resets dialogue values.

## Notes / risks

- **macOS (Task A2/A3):** the macOS backend changes compile only on macOS; they cannot be verified from Windows. Keep them a faithful mirror of the `loudness_weights` edits. macOS runtime sign-off stays pending a Mac (per spec).
- **Pre-commit hook:** commits that touch `src-tauri/Cargo.toml` regenerate `Cargo.lock`; the `time = "=0.3.47"` pin keeps it stable. This slice does not add Rust deps, so the lock should not move.
- **`fmtMetric` / `displayAudio` field names:** Task B4 assumes `displayAudio.integrated` exists (it does). Confirm the exact camelCase keys produced by `useAudioEngine` when wiring Task B2 (e.g. `dialoguePercent` vs `dialogue_percent`).
