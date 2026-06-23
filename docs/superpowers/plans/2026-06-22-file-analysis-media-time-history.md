# File Analysis Media-Time History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make file-analysis frames and history use media time instead of wall-clock time, and decouple UI frame rate from history resolution so fast offline analysis neither floods the UI nor coarsens scrub.

**Architecture:** Add a second timing mode to `MeterPipeline` while keeping the live path unchanged. File analysis passes cumulative decoded media time into the pipeline. The frontend keeps using `selectedOffset`, but derives file scrub display time from the resolved target media timestamp rather than from the live session timer.

For frame rate vs history resolution, this plan implements the **batched history tick** model (decision A''):

- file mode keeps the existing ~16ms wall-clock emit throttle (it does **not** force a frame per decoded chunk, which would flood the UI);
- but the pipeline keeps generating loudness/visual history ticks at full media-time resolution and buffers them between emits;
- each emitted frame carries a batch (`Vec`) of all ticks accumulated since the previous emit, plus a final flush frame at end-of-stream;
- `FrameIntake` ingests the whole batch into the bounded history rings.

This bounds the number of frames/events crossing the IPC channel while keeping Spectrum/Vectorscope/loudness history fine-grained for scrub. History accumulation stays in the frontend; no backend history ownership change.

**Tech Stack:** Rust 2021, existing DSP `MeterPipeline`, Vitest, existing `FrameIntake` / `snapshotResolve` timestamp matching.

**Spec:** `docs/superpowers/specs/2026-06-22-file-analysis-mode-design.md`

---

## File Structure

Modify:

- `src-tauri/src/engine/meter_pipeline.rs` — add file/media-time push path, batched history ticks, a `now_sec` boundary comment, and tests.
- `src-tauri/src/ipc/types.rs` — add batched history tick fields to `AudioFramePayload`.
- `src-tauri/src/file_analysis/session.rs` — use the media-time pipeline constructor/push and flush the final batch before completion.
- `src/lib/FrameIntake.js` — ingest batched history ticks in addition to the singular live ticks.
- `src/lib/snapshotResolve.js` — export selected target timestamp for UI display if not already sufficient.
- `src/lib/snapshotResolve.test.js` — prove file/media timestamp matching.
- `src/lib/sourceTransportState.js` — accept top-level `selectedMediaTimeMs` for file scrub display.
- `src/lib/sourceTransportState.test.js` — cover media-time display.
- `src/App.jsx` — pass file selected media time from snapshot resolution into source transport state once file sessions are wired.

Do not modify in this plan:

- media decoding support;
- file picker/drag/drop UI;
- summary metrics display;
- right-side toolbar layout.

---

### Task 1: Add Pipeline Clock Mode Tests

**Files:**
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

- [ ] **Step 1: Add failing test for media-time timestamps**

Add this test to the existing `#[cfg(test)] mod tests` in `meter_pipeline.rs`:

```rust
#[test]
fn file_mode_frame_uses_supplied_media_time() {
  let sr = 48_000_u32;
  let channels = 2_u16;
  let mut pipeline = MeterPipeline::new_for_file(sr, channels);
  let pcm = vec![0.1_f32; (sr as usize / 10) * channels as usize];
  let requests = AnalysisRequests::default();

  let frame = pipeline
    .push_pcm_f32_with_requests_at_media_time(
      &pcm,
      ChannelLayoutSetting::Auto,
      &requests,
      None,
      false,
      12_345,
    )
    .expect("file frame");

  assert_eq!(frame.timestamp_ms, 12_345);
  assert_eq!(
    frame.loudness_hist_tick.as_ref().map(|entry| entry.timestamp_ms),
    Some(12_345)
  );
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd src-tauri
cargo test file_mode_frame_uses_supplied_media_time
```

Expected: FAIL because `new_for_file` and `push_pcm_f32_with_requests_at_media_time` do not exist.

- [ ] **Step 3: Commit nothing**

Do not commit the failing test alone unless this repository's current branch prefers red commits. Continue to the implementation step before committing.

---

### Task 2: Add Media-Time Pipeline Entry Point

**Files:**
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

- [ ] **Step 1: Add timing fields**

Add these fields to `MeterPipeline`:

```rust
file_timing: bool,
current_media_time_ms: Option<u64>,
```

Initialize them in `MeterPipeline::new`:

```rust
file_timing: false,
current_media_time_ms: None,
```

- [ ] **Step 2: Add constructor**

Add to `impl MeterPipeline`:

```rust
pub fn new_for_file(sample_rate: u32, channels: u16) -> Self {
  let mut pipeline = Self::new(sample_rate, channels);
  pipeline.file_timing = true;
  pipeline
}
```

- [ ] **Step 3: Add media-time timestamp helper**

Add a private method, with a comment documenting the `now_sec` boundary:

```rust
// File mode overrides only the emitted/stored timestamps with media time. The DSP's internal
// `now_sec` (used for Spectrum temporal smoothing and peak-hold decay) intentionally stays
// wall-clock: in file mode it advances slower than media time, so those visual decays look
// under-decayed/"frozen". That is acceptable because the authoritative metrics (integrated
// loudness, LRA, true/sample peak) are sample-driven and unaffected by decode speed. Do not
// retime `now_sec` to media time in this slice.
fn timestamp_ms(&self) -> u64 {
  self
    .current_media_time_ms
    .unwrap_or_else(|| self.t0.elapsed().as_millis() as u64)
}
```

Replace each `self.t0.elapsed().as_millis() as u64` assignment for emitted payloads/history entries with:

```rust
self.timestamp_ms()
```

This affects top-level `AudioFramePayload.timestamp_ms`, `MeterHistoryEntry.timestamp_ms`, and `VisualHistEntry.timestamp_ms`. Each history tick is stamped with the media time of the push that produced it, so batched ticks keep correct individual timestamps.

- [ ] **Step 4: Add media-time push wrapper**

Add:

```rust
pub fn push_pcm_f32_with_requests_at_media_time(
  &mut self,
  interleaved: &[f32],
  channel_layout: ChannelLayoutSetting,
  analysis_requests: &AnalysisRequests,
  loudness_weights: Option<Vec<f64>>,
  dialogue_gating: bool,
  media_time_ms: u64,
) -> Option<AudioFramePayload> {
  self.current_media_time_ms = Some(media_time_ms);
  let frame = self.push_pcm_f32_with_requests(
    interleaved,
    channel_layout,
    analysis_requests,
    loudness_weights,
    dialogue_gating,
  );
  self.current_media_time_ms = None;
  frame
}
```

- [ ] **Step 5: Keep the wall-clock throttle in file mode (do not force per chunk)**

Leave the existing emit throttle unchanged:

```rust
let force_frame = self.pending_loudness_hist.is_some();
if !force_frame && self.last_frame_emit.elapsed().as_millis() < FRAME_EMIT_MS {
  return None;
}
```

Do **not** add `self.file_timing` to `force_frame`. Forcing a frame per decoded
chunk would emit thousands of frames per wall-clock second for a fast decode and
flood the UI. File mode reuses the same ~16ms wall-clock cadence as live; history
resolution is preserved by batching ticks (next steps), not by emitting more
frames.

- [ ] **Step 6: Run focused Rust test**

Run:

```bash
cd src-tauri
cargo test file_mode_frame_uses_supplied_media_time
```

Expected: PASS.

- [ ] **Step 7: Run full pipeline tests**

Run:

```bash
cd src-tauri
cargo test engine::meter_pipeline
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat(engine): support media-time meter frames"
```

---

### Task 2b: Batch history ticks so file mode keeps fine scrub without flooding

**Files:**
- Modify: `src-tauri/src/ipc/types.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`

- [ ] **Step 1: Add batch fields to the payload**

In `src-tauri/src/ipc/types.rs`, add two additive batch fields to
`AudioFramePayload`, next to the existing singular tick fields:

```rust
/// File-mode batch of loudness history ticks accumulated since the previous emitted frame.
/// Empty in live mode (which uses `loudness_hist_tick`).
#[serde(default, skip_serializing_if = "Vec::is_empty")]
pub loudness_hist_batch: Vec<MeterHistoryEntry>,
/// File-mode batch of visual history ticks accumulated since the previous emitted frame.
/// Empty in live mode (which uses `visual_hist_tick`).
#[serde(default, skip_serializing_if = "Vec::is_empty")]
pub visual_hist_batch: Vec<VisualHistEntry>,
```

Live mode leaves these empty and keeps using the singular `loudness_hist_tick` /
`visual_hist_tick`. File mode fills the batches and leaves the singular fields
`None`.

- [ ] **Step 2: Buffer ticks in file mode instead of forcing frames**

Add buffers to `MeterPipeline`:

```rust
file_loudness_batch: Vec<MeterHistoryEntry>,
file_visual_batch: Vec<VisualHistEntry>,
```

Initialize them empty in `new`.

In file mode (`self.file_timing`), wherever the live path would set
`pending_loudness_hist` (which forces an emit) or attach a single
`visual_hist_tick`, instead push the stamped entry onto the matching buffer and
do **not** set `pending_loudness_hist`. This keeps full-resolution ticks without
forcing one frame per tick.

When a frame is actually emitted (on the wall-clock throttle), drain the buffers
into the frame and clear them:

```rust
if self.file_timing {
  frame.loudness_hist_batch = std::mem::take(&mut self.file_loudness_batch);
  frame.visual_hist_batch = std::mem::take(&mut self.file_visual_batch);
  frame.loudness_hist_tick = None;
  frame.visual_hist_tick = None;
}
```

- [ ] **Step 3: Add an explicit final-flush path**

Add a method that emits any remaining buffered ticks as one last frame, so the
tail of the file (the ticks generated after the last throttled emit) is not lost:

```rust
pub fn flush_file_batch(&mut self) -> Option<AudioFramePayload> {
  if !self.file_timing
    || (self.file_loudness_batch.is_empty() && self.file_visual_batch.is_empty())
  {
    return None;
  }
  let mut frame = self.assemble_current_frame(); // reuse the existing frame assembler
  frame.loudness_hist_batch = std::mem::take(&mut self.file_loudness_batch);
  frame.visual_hist_batch = std::mem::take(&mut self.file_visual_batch);
  Some(frame)
}
```

Use whatever the existing internal frame-assembly entry point is; the point is a
single trailing frame carrying the leftover batch.

- [ ] **Step 4: Add a batching test**

Add to `meter_pipeline.rs` tests: push enough file-mode PCM to produce several
loudness/visual ticks within one ~16ms wall-clock window, assert that a single
emitted frame carries a `loudness_hist_batch` / `visual_hist_batch` with more
than one entry, and that `flush_file_batch` returns the trailing entries.

- [ ] **Step 5: Ingest batches in `FrameIntake`**

In `src/lib/FrameIntake.js`, where the current code appends the singular
`loudness_hist_tick` / `visual_hist_tick` to the bounded rings, also iterate the
batch fields in order:

```js
const loudnessTicks = frame.loudnessHistTick
  ? [frame.loudnessHistTick]
  : frame.loudnessHistBatch ?? [];
for (const tick of loudnessTicks) appendLoudnessTick(tick);

const visualTicks = frame.visualHistTick
  ? [frame.visualHistTick]
  : frame.visualHistBatch ?? [];
for (const tick of visualTicks) appendVisualTick(tick);
```

Use the existing append/ring logic; do not change ring capacities here.

- [ ] **Step 6: Add a FrameIntake batch test**

In `src/lib/FrameIntake.test.js`, feed one frame carrying a `visualHistBatch` of
several entries and assert all of them land in the visual ring in order.

- [ ] **Step 7: Run focused tests**

Run:

```bash
cd src-tauri
cargo test engine::meter_pipeline
```

```bash
npx vitest run src/lib/FrameIntake.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/ipc/types.rs src-tauri/src/engine/meter_pipeline.rs src/lib/FrameIntake.js src/lib/FrameIntake.test.js
git commit -m "feat(engine): batch file-mode history ticks"
```

---

### Task 3: Pass Media Time From File Session

**Files:**
- Modify: `src-tauri/src/file_analysis/session.rs`

- [ ] **Step 1: Change pipeline constructor**

In `run_file_worker`, replace:

```rust
let mut pipeline = MeterPipeline::new(sample_rate, channels);
```

with:

```rust
let mut pipeline = MeterPipeline::new_for_file(sample_rate, channels);
```

- [ ] **Step 2: Compute media time from decoded frames**

Immediately after `decoded_frames` is updated, add:

```rust
let media_time_ms = ((decoded_frames as f64 / sample_rate as f64) * 1000.0).round() as u64;
```

Replace:

```rust
if let Some(mut frame) = pipeline.push_pcm_f32_with_requests(
  &pcm,
  ChannelLayoutSetting::Auto,
  &requests,
  loudness_weights,
  dialogue_gating,
) {
```

with:

```rust
if let Some(mut frame) = pipeline.push_pcm_f32_with_requests_at_media_time(
  &pcm,
  ChannelLayoutSetting::Auto,
  &config.requests,
  config.loudness_weights.clone(),
  config.dialogue_gating,
  media_time_ms,
) {
```

(The worker already snapshots config once; keep using `config.*` here.)

- [ ] **Step 2b: Flush the trailing batch before completion**

After the decode loop ends (end-of-stream), before emitting
`file-analysis-completed`, drain the final buffered ticks so the tail of the file
is scrubbable:

```rust
if let Some(mut frame) = pipeline.flush_file_batch() {
  seq += 1;
  frame.seq = seq;
  send_frame(&frame_subscribers, frame)?;
}
```

The user-`STOP` early-return path does not flush, matching its "cancelled, not
completed" semantics.

- [ ] **Step 3: Run Rust checks**

Run:

```bash
cd src-tauri
cargo test file_analysis
cargo test engine::meter_pipeline
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/file_analysis/session.rs
git commit -m "feat(file): stamp analysis frames with media time"
```

---

### Task 4: Make Snapshot Resolution Expose Target Time

**Files:**
- Modify: `src/lib/snapshotResolve.test.js`
- Modify: `src/lib/snapshotResolve.js`

- [ ] **Step 1: Add test for target timestamp passthrough**

Append to `src/lib/snapshotResolve.test.js`:

```js
it("returns the selected target timestamp for UI display", () => {
  const r = resolveSnapshot(
    baseView({
      selectedOffset: 1,
      histSourceList: [{ timestampMs: 10_000 }, { timestampMs: 20_000 }, { timestampMs: 30_000 }],
      audioList: [{}, {}, {}],
      corrList: [0, 0, 0],
      spectrumDataList: [{}, {}, {}],
    })
  );

  expect(r.targetTimestampMs).toBe(29_000);
});
```

- [ ] **Step 2: Run focused test**

Run:

```bash
npx vitest run src/lib/snapshotResolve.test.js
```

Expected: PASS if `targetTimestampMs` already exists in the return value. If it fails, add `targetTimestampMs` to the returned object in `resolveSnapshot`.

- [ ] **Step 3: Commit if code changed**

If `snapshotResolve.js` changed:

```bash
git add src/lib/snapshotResolve.js src/lib/snapshotResolve.test.js
git commit -m "feat(snapshot): expose selected target timestamp"
```

If only the test was added and passes:

```bash
git add src/lib/snapshotResolve.test.js
git commit -m "test(snapshot): cover selected target timestamp"
```

---

### Task 5: Feed File Scrub Time Into Transport State

**Files:**
- Modify: `src/lib/sourceTransportState.test.js`
- Modify: `src/lib/sourceTransportState.js`
- Modify: `src/App.jsx`

- [ ] **Step 1: Add source state test for selected media time**

Ensure `src/lib/sourceTransportState.test.js` contains:

```js
it("derives file scrub display from selected media time", () => {
  expect(
    deriveSourceTransportState({
      sourceMode: "file",
      selectedOffset: 3,
      selectedMediaTimeMs: 84_000,
      fileSession: { state: "complete", fileName: "final_mix.wav" },
    })
  ).toMatchObject({
    sourceLabel: "File",
    statusLabel: "00:01:24",
    actionLabel: "RESULT",
    chromeState: "snapshot",
    actionKind: "returnToFileResult",
  });
});
```

- [ ] **Step 2: Use the single canonical source for scrub time**

`selectedMediaTimeMs` has one canonical source: a top-level field on the
`deriveSourceTransportState` input, supplied by `App.jsx` from snapshot
resolution. The UI shell plan must already read this top-level field (not
`fileSession.selectedMediaTimeMs`); if any earlier draft nested it under
`fileSession`, remove that path so there is exactly one source:

```js
const selectedMediaTimeMs = input.selectedMediaTimeMs;
```

File scrub should render `RESULT` whenever `sourceMode === "file"`,
`selectedOffset >= 0`, and `selectedMediaTimeMs` is finite.

- [ ] **Step 3: Wire from `App.jsx`**

Where `useSnapshot` returns `resolved` data, expose the target timestamp as `selectedMediaTimeMs` for file mode. If `useSnapshot` currently hides `targetTimestampMs`, modify `useSnapshot` to return it as `targetTimestampMs`.

Then pass into `deriveSourceTransportState`:

```js
selectedMediaTimeMs: sourceMode === "file" ? snapshotTargetTimestampMs : undefined,
```

Use the exact variable name that `useSnapshot` returns. Keep this path inert in live mode.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run src/lib/sourceTransportState.test.js src/hooks/useSnapshot.test.jsx src/App.toolbar.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sourceTransportState.js src/lib/sourceTransportState.test.js src/hooks/useSnapshot.js src/hooks/useSnapshot.test.jsx src/App.jsx src/App.toolbar.test.js
git commit -m "feat(ui): display file scrub media time"
```

---

### Task 6: Document Long-File History Policy In Code

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/lib/FrameIntake.js` only if naming comments are needed.

- [ ] **Step 1: Keep existing capacities for the first implementation**

Do not increase:

```js
const HIST_MAX_SAMPLES = 72000;
const VISUAL_MAX_SAMPLES = 180_000;
```

Add this comment above them in `src/App.jsx`:

```js
// Live and file sessions share bounded display history. File-mode summary metrics are authoritative
// for the whole file; panel history is an inspectable downsampled/session view, not unlimited storage.
```

- [ ] **Step 2: Run lint for changed frontend files**

Run:

```bash
npx eslint src/App.jsx src/lib/sourceTransportState.js src/hooks/useSnapshot.js src/lib/snapshotResolve.js
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx src/lib/FrameIntake.js
git commit -m "docs(ui): clarify bounded file history policy"
```

If `FrameIntake.js` was not changed, omit it from `git add`.

---

### Task 7: Verification

**Files:**
- No planned file edits.

- [ ] **Step 1: Run Rust checks**

Run:

```bash
cd src-tauri
cargo test engine::meter_pipeline
cargo test file_analysis
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run:

```bash
npx vitest run src/lib/snapshotResolve.test.js src/hooks/useSnapshot.test.jsx src/lib/sourceTransportState.test.js src/App.toolbar.test.js
```

Expected: PASS.

- [ ] **Step 3: Confirm live timestamp behavior still exists**

Run:

```bash
rg "t0.elapsed|new_for_file|push_pcm_f32_with_requests_at_media_time" src-tauri/src/engine/meter_pipeline.rs
```

Expected:

```txt
t0.elapsed
new_for_file
push_pcm_f32_with_requests_at_media_time
```

The live path should still have a wall-clock fallback through `timestamp_ms()`.

---

## Self-Review

Spec coverage:

- Covers media-time timestamps for file mode.
- Covers the `now_sec` boundary (visual decay distorts; sample-driven metrics safe) as an in-code comment.
- Covers batched history ticks (A''): wall-clock-throttled frames, full-resolution history via batches + final flush, `FrameIntake` batch ingest. No UI flood, no coarse scrub, history stays in the frontend.
- Covers scrub display without the word `Snapshot`.
- Covers a single canonical `selectedMediaTimeMs` source.
- Covers bounded history policy.
- Leaves file picker, drag/drop, summary surface, and progress UI for the frontend integration plan.

Placeholder scan:

- No placeholder markers or unnamed implementation steps.

Type consistency:

- Rust file path uses `MeterPipeline::new_for_file`.
- Rust push path is `push_pcm_f32_with_requests_at_media_time`.
- Batch fields are `loudness_hist_batch` / `visual_hist_batch` (camelCase `loudnessHistBatch` / `visualHistBatch` in JS).
- Frontend selected file time is represented as a top-level `selectedMediaTimeMs`.
