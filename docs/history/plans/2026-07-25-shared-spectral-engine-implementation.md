# Shared Spectral Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Replace per-request Spectrum FFT banks with one worker-owned, synchronized spectral transform layer while preserving every observable Spectrum behavior and payload.

**Architecture:** Split the current `StftAnalyzer` into immutable complex transform output and request-keyed PSD consumers. `MeterPipeline` plans only the physical channels or direct projections needed by active consumers, keeps all mutable state on the meter worker, and overlaps old/new transform topologies until an unchanged Spectrum consumer can hand off without a blank or reset.

**Tech Stack:** Rust, rustfft, Tauri 2, existing inline Rust tests, Vitest contract tests, existing capture smoke/soak scripts.

**Design:** `docs/superpowers/specs/2026-07-25-shared-spectral-engine-design.md`

## Preconditions and invariants

- Work in `C:\Users\shenxichen\repos\PLVS\.claude\worktrees\stereo-map`.
- If Rust reports a missing sidecar or a misleading `serde_derive` build failure, run `npm run ffmpeg:fetch`.
- Do not change Spectrum request keys, Rust/JS IPC shapes, grid density, calibration, history cadence, or frontend code.
- Do not allocate, lock, FFT, or syscall on the audio callback thread.
- Keep the legacy `SpectrumMeter` runnable in differential tests until the final gate passes.
- Set numerical tolerances from measured floating-point ordering differences. Do not widen them merely to obtain green tests.
- Each task defines a focused commit checkpoint. Run its commit step only when the user has explicitly authorized commits; otherwise leave the verified changes uncommitted.
- When commits are authorized, do not combine later tasks into an earlier commit.

---

### Task 1: Extract a normalized complex transform

**Files:**

- Create: `src-tauri/src/dsp/spectral_transform.rs`
- Modify: `src-tauri/src/dsp/spectrum_bank.rs`
- Modify: `src-tauri/src/dsp/mod.rs`

**Step 1: Write failing transform tests**

Add inline tests in `spectral_transform.rs` for:

- no output before a full FFT window;
- output exactly on the configured global hop phase;
- finite normalized bins for silence and a bin-aligned full-scale sine;
- a late-created transform whose ring/hop position is initialized from a supplied sample clock;
- identical output across different PCM chunk boundaries.

Use a result type shaped like:

```rust
pub struct ComplexSpectralFrame<'a> {
    pub fft_size: usize,
    pub sample_clock: u64,
    pub bins: &'a [Complex32],
}
```

**Step 2: Run the tests to verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml spectral_transform
```

Expected: compilation fails because `SpectralTransform` does not exist.

**Step 3: Implement the minimum transform**

Move only Hann-window, ring-buffer, hop scheduling, real FFT, one-sided normalization, and complex scratch ownership out of `StftAnalyzer`. Keep Speed-dependent EMA out of this type.

Required constructor contract:

```rust
pub fn new(fft_size: usize, overlap: usize, initial_sample_clock: u64) -> Self;
```

Required push contract: consume scalar samples, advance the supplied pipeline clock, and expose a borrowed frame only when this transform's hop is due and its complete window is warm.

Have legacy `StftAnalyzer` delegate transform production to the new type while retaining its existing EMA behavior. This keeps production behavior unchanged.

**Step 4: Run focused regressions**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml spectral_transform
cargo test --manifest-path src-tauri/Cargo.toml spectrum_bank
cargo test --manifest-path src-tauri/Cargo.toml spectrum
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src-tauri/src/dsp/spectral_transform.rs src-tauri/src/dsp/spectrum_bank.rs src-tauri/src/dsp/mod.rs
git commit -m "refactor: separate spectral transforms from averaging"
```

---

### Task 2: Extract request-keyed spectral accumulation

**Files:**

- Create: `src-tauri/src/dsp/spectrum_consumer.rs`
- Modify: `src-tauri/src/dsp/spectrum.rs`
- Modify: `src-tauri/src/dsp/spectrum_bank.rs`
- Modify: `src-tauri/src/dsp/mod.rs`

**Step 1: Write failing consumer tests**

Cover:

- first-frame EMA initialization exactly matches legacy `StftAnalyzer`;
- Speed zero bypasses hidden averaging exactly as today;
- per-resolution EMA uses the current `hop_sec` and `analysis_average_sec`;
- grid taps, crossover blending, octave smoothing, weighting, Tilt, envelope, and peak hold occur in the existing order;
- two consumers fed the same complex frame but different Speed values keep independent mutable state.

The core update equation remains:

```rust
alpha = 1.0 - (-hop_sec / analysis_average_sec).exp();
average += alpha * (instantaneous_power - average);
```

**Step 2: Verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml spectrum_consumer
```

Expected: compilation fails because the consumer is absent.

**Step 3: Implement one-curve consumption**

Implement a consumer that owns:

- three resolution-specific linear-power EMAs;
- the existing log-grid tap/crossover data;
- octave smoothing;
- display envelope and peak-hold state.

It must not own FFT rings, FFT plans, windows, or complex scratch arrays.

Move reusable display shaping from `SpectrumMeter` only when necessary. Keep `SpectrumMeter` as a legacy wrapper/reference, not as the new production owner.

**Step 4: Verify focused parity**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml spectrum_consumer
cargo test --manifest-path src-tauri/Cargo.toml spectrum_bank
cargo test --manifest-path src-tauri/Cargo.toml spectrum
```

Expected: all pass with production still using legacy `SpectrumMeter`.

**Step 5: Commit**

```powershell
git add src-tauri/src/dsp/spectrum_consumer.rs src-tauri/src/dsp/spectrum.rs src-tauri/src/dsp/spectrum_bank.rs src-tauri/src/dsp/mod.rs
git commit -m "refactor: isolate keyed spectrum accumulation"
```

---

### Task 3: Prove complex-domain Spectrum projections

**Files:**

- Modify: `src-tauri/src/dsp/spectrum_consumer.rs`
- Modify: `src-tauri/src/dsp/spectrum.rs`

**Step 1: Add failing projection tests**

Use deterministic aligned complex bins and time-domain PCM fixtures to prove:

```text
Single(c)  = Xc
Combined   = 0.5 * (X + Y)
L curve    = X
R curve    = Y
Mid curve  = 0.5 * (X + Y)
Side curve = 0.5 * (X - Y)
```

Include in-phase, anti-phase, unequal-amplitude, hard-panned, and 90-degree cases. Assert that power is computed after complex combination, preserving cross terms.

**Step 2: Verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml spectrum_consumer projection
```

Expected: tests fail because pair projections are not implemented.

**Step 3: Implement pair projections**

Add explicit projection helpers over aligned bins. Do not average independent powers for Combined, Mid, or Side.

Support primary/secondary curve output without creating additional transform ownership inside the consumer.

**Step 4: Verify**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml spectrum_consumer
cargo test --manifest-path src-tauri/Cargo.toml spectrum
```

Expected: projection and legacy tests pass.

**Step 5: Commit**

```powershell
git add src-tauri/src/dsp/spectrum_consumer.rs src-tauri/src/dsp/spectrum.rs
git commit -m "test: lock spectrum projection parity"
```

---

### Task 4: Add the request planner

**Files:**

- Create: `src-tauri/src/engine/spectral_plan.rs`
- Modify: `src-tauri/src/engine/mod.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

**Step 1: Write failing planner tests**

Test plans for:

- no active frequency requests: no streams;
- lone Combined request: one direct `0.5 * (L + R)` projection stream;
- duplicate Combined requests with different Speed/Smoothing: one transform stream, two consumers;
- L/R or M/S request: two physical channel streams;
- a future pair consumer plus Combined: two physical streams and no redundant Combined projection after handoff;
- inactive keys and unrelated channels absent from the plan;
- deterministic stream identities independent of request order.

Use stable plan identities such as:

```rust
enum TransformStreamId {
    Physical(usize),
    Projection { first: usize, second: usize, kind: ProjectionKind },
}
```

**Step 2: Verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml spectral_plan
```

Expected: module/type missing.

**Step 3: Implement pure planning**

Planner input is the current validated request set plus channel layout. Planner output contains transform streams and consumer bindings only; it performs no FFT and owns no mutable DSP state.

Add the planner to `MeterPipeline` behind test-only inspection. Do not route production Spectrum through it yet.

**Step 4: Verify**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml spectral_plan
cargo test --manifest-path src-tauri/Cargo.toml engine::meter_pipeline
```

Expected: all pass; existing Spectrum output remains legacy-owned.

**Step 5: Commit**

```powershell
git add src-tauri/src/engine/spectral_plan.rs src-tauri/src/engine/mod.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat: plan shared spectral transform streams"
```

---

### Task 5: Build the synchronized shared engine

**Files:**

- Create: `src-tauri/src/dsp/shared_spectral_engine.rs`
- Modify: `src-tauri/src/dsp/mod.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

**Step 1: Write failing engine tests**

Cover:

- all streams share one pipeline-global sample clock;
- L/R physical streams emit aligned frames for each FFT size;
- a late-added stream inherits clock/hop phase but emits nothing until the longest window is warm;
- removing a stream stops its FFT work;
- unchanged streams retain ring history across plan updates;
- each stream/FFT-size executes at most once at a due hop;
- complex frames are borrowed and consumed before the next mutable push.

**Step 2: Verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml shared_spectral_engine
```

Expected: module/type missing.

**Step 3: Implement stream ownership**

`SharedSpectralEngine` owns three `SpectralTransform`s per planned stream, using current FFT sizes and overlaps. It applies physical-channel selection or time-domain direct projection before pushing each scalar sample.

Expose deterministic test counters for FFT invocations. Keep counters test/benchmark-only so production work is unchanged.

**Step 4: Add a non-production pipeline harness**

Let `MeterPipeline` feed the shared engine alongside the legacy path under `#[cfg(test)]`. The harness must not serialize complex bins or alter `AudioFramePayload`.

**Step 5: Verify**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml shared_spectral_engine
cargo test --manifest-path src-tauri/Cargo.toml spectral_plan
cargo test --manifest-path src-tauri/Cargo.toml engine::meter_pipeline
```

Expected: all pass.

**Step 6: Commit**

```powershell
git add src-tauri/src/dsp/shared_spectral_engine.rs src-tauri/src/dsp/mod.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "feat: add synchronized shared spectral engine"
```

---

### Task 6: Add deterministic differential fixtures

**Files:**

- Create: `src-tauri/src/dsp/spectrum_fixtures.rs`
- Create: `src-tauri/src/dsp/spectrum_differential.rs`
- Modify: `src-tauri/src/dsp/mod.rs`
- Modify: `src-tauri/src/dsp/spectrum.rs`
- Modify: `src-tauri/src/dsp/spectrum_consumer.rs`

**Step 1: Build deterministic fixtures**

Create reusable PCM fixtures for:

- silence and impulse;
- bin-aligned and non-aligned sine;
- seeded white noise;
- independent L/R noise;
- hard pan;
- equal/unequal in-phase signals;
- anti-phase and 90-degree phase pairs;
- sample rates already supported by pipeline tests;
- PCM chunkings of one sample, irregular blocks, and normal capture blocks.

Do not use nondeterministic RNG or wall time.

**Step 2: Write failing legacy-vs-shared comparisons**

For all UI-exposed channel/view/Speed/Smoothing/Tilt combinations compare:

- exact band centers and payload lengths;
- readiness timing;
- primary and secondary smooth rows;
- peak rows;
- reset timing.

Start with zero tolerance to expose ordering differences, then document the smallest measured tolerance beside each assertion helper.

**Step 3: Verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml spectrum_differential
```

Expected: at least one fixture fails until the new consumer is fully compatible.

**Step 4: Correct the shared path**

Fix ordering, initialization, projection, or calibration differences in the shared implementation. Do not modify legacy behavior to make comparisons pass.

**Step 5: Verify**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml spectrum_differential
cargo test --manifest-path src-tauri/Cargo.toml dsp::spectrum
cargo test --manifest-path src-tauri/Cargo.toml dsp::spectrum_bank
```

Expected: all fixtures pass at documented tolerances.

**Step 6: Commit**

```powershell
git add src-tauri/src/dsp/spectrum_fixtures.rs src-tauri/src/dsp/spectrum_differential.rs src-tauri/src/dsp/mod.rs src-tauri/src/dsp/spectrum.rs src-tauri/src/dsp/spectrum_consumer.rs
git commit -m "test: compare shared and legacy spectrum paths"
```

---

### Task 7: Implement overlap-and-handoff

**Files:**

- Modify: `src-tauri/src/dsp/shared_spectral_engine.rs`
- Modify: `src-tauri/src/engine/spectral_plan.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`
- Modify: `src-tauri/src/dsp/spectrum_consumer.rs`

**Step 1: Write failing topology-transition tests**

Start a lone Combined request, then add and remove a pair-requiring plan. Assert:

- the original projection continues while physical streams warm;
- all three physical resolutions are aligned and ready before eligibility;
- source switch occurs on a common hop boundary;
- request-keyed Speed EMA, display envelope, and peak hold are not reset;
- no blank or stale result is emitted for the unchanged request;
- obsolete streams are eventually pruned;
- inverse handoff obeys the same rules.

**Step 2: Verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml engine::meter_pipeline topology
```

Expected: transition tests fail because plans currently replace streams immediately.

**Step 3: Implement transition state**

Track desired, warming, active, and retiring stream bindings in the pipeline/engine boundary. Consumers keep their identity and mutable state; only their spectral source changes.

Do not emit from an incomplete source and do not keep retired streams after handoff.

**Step 4: Verify**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml engine::meter_pipeline topology
cargo test --manifest-path src-tauri/Cargo.toml spectrum_differential
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src-tauri/src/dsp/shared_spectral_engine.rs src-tauri/src/engine/spectral_plan.rs src-tauri/src/engine/meter_pipeline.rs src-tauri/src/dsp/spectrum_consumer.rs
git commit -m "feat: preserve spectrum across spectral topology changes"
```

---

### Task 8: Cover lifecycle, Clear, and file analysis

**Files:**

- Modify: `src-tauri/src/engine/meter_pipeline.rs`
- Modify: `src-tauri/src/file_analysis/session.rs`
- Modify: `src-tauri/src/audio/cpal_backend.rs`

**Step 1: Add failing lifecycle tests**

Cover:

- request add/remove and current no-backfill pruning;
- invalid channel request handling remains at the existing boundary;
- `clear_peak_and_history` resets transforms, averages, envelopes, and holds;
- sample-rate/channel-layout rebuild does not mix incompatible grids;
- file analysis uses the same shared path and media-time visual-history cadence;
- live capture constructs the engine on the bridge worker, not in the callback.

**Step 2: Verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml engine::meter_pipeline
cargo test --manifest-path src-tauri/Cargo.toml file_analysis::session
```

Expected: new shared-path lifecycle assertions fail.

**Step 3: Implement lifecycle integration**

Wire resets and rebuilds through the shared engine and consumers. Keep capture callback code free of new analysis work; only the existing bridge worker owns the engine.

Do not change file analysis chunk cadence or serialized history shape.

**Step 4: Verify**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml engine::meter_pipeline
cargo test --manifest-path src-tauri/Cargo.toml file_analysis::session
cargo test --manifest-path src-tauri/Cargo.toml audio::cpal_backend
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src-tauri/src/engine/meter_pipeline.rs src-tauri/src/file_analysis/session.rs src-tauri/src/audio/cpal_backend.rs
git commit -m "test: cover shared spectral lifecycle paths"
```

---

### Task 9: Cut production Spectrum over to the shared path

**Files:**

- Modify: `src-tauri/src/engine/meter_pipeline.rs`
- Modify: `src-tauri/src/dsp/spectrum.rs`
- Modify: `src-tauri/src/dsp/spectrum_consumer.rs`

**Step 1: Add payload-shape regression tests**

In pipeline tests, capture legacy and shared `SpectrumFrameResult`/`SpectrumVisualEntry` output and assert:

- identical request-key maps;
- exact band-center and array lengths;
- unchanged primary/secondary presence;
- unchanged path generation;
- unchanged pending/readiness and visual tick behavior.

**Step 2: Verify tests pass against the test-only shared harness**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml engine::meter_pipeline spectrum
```

Expected: parity tests pass before cutover.

**Step 3: Replace production ownership**

Replace `spectrum_by_key: HashMap<String, SpectrumMeter>` with request-keyed `SpectrumConsumer`s fed by `SharedSpectralEngine`.

Keep:

- existing request validation and cap;
- `spectrum_results_by_key`;
- existing SVG path conversion;
- existing visual-history row shape and cadence;
- existing file/live callers.

Do not edit frontend or IPC type definitions.

**Step 4: Run the full Rust and JS contract gates**

Run:

```powershell
npm run rust:test
npm test -- src/analysis/analysisRequestKeyFormat.test.js src/analysis/analysisRequests.test.js
```

Expected: all pass.

**Step 5: Commit**

```powershell
git add src-tauri/src/engine/meter_pipeline.rs src-tauri/src/dsp/spectrum.rs src-tauri/src/dsp/spectrum_consumer.rs
git commit -m "refactor: route spectrum through shared transforms"
```

---

### Task 10: Prove FFT-count and migration overhead budgets

**Files:**

- Create: `src-tauri/benches/spectral_fft_count.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/dsp/shared_spectral_engine.rs`

**Step 1: Add deterministic count assertions**

Before adding wall-clock benchmarking, add unit-test counters proving:

- lone Combined = one stream per FFT size;
- duplicate Combined requests do not add transforms;
- different Speed/Smoothing consumers reuse transforms;
- duplicate pair consumers use two physical streams, not per-key banks;
- mixed four-Spectrum plus four-pair-consumer planning stays at the stream count implied by unique channels/projections.

**Step 2: Verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml fft_count
```

Expected: missing counters/assertions or excess transforms fail.

**Step 3: Add a benchmark harness**

Add a non-default Criterion dev dependency and `[[bench]]` entry only if Criterion is not already present. Record:

- FFT invocations;
- processed audio duration per wall-clock duration;
- scratch and persistent spectral memory estimates;
- lone Combined migration overhead;
- representative duplicate-channel reduction;
- four Spectrum plus four future pair consumers.

Keep pass/fail acceptance structural/count-based; report timing without fragile CI thresholds.

**Step 4: Verify**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml fft_count
cargo bench --manifest-path src-tauri/Cargo.toml --bench spectral_fft_count
```

Expected: count assertions pass and benchmark completes.

**Step 5: Commit**

```powershell
git add src-tauri/benches/spectral_fft_count.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/dsp/shared_spectral_engine.rs
git commit -m "perf: benchmark shared spectral transform reuse"
```

---

### Task 11: Remove the legacy production path

**Files:**

- Modify: `src-tauri/src/dsp/spectrum.rs`
- Modify: `src-tauri/src/dsp/spectrum_bank.rs`
- Modify: `src-tauri/src/dsp/spectrum_differential.rs`
- Modify: `src-tauri/src/engine/meter_pipeline.rs`

**Step 1: Confirm the deletion gate**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml spectrum_differential
npm run rust:test
```

Expected: all pass before deletion.

**Step 2: Remove only obsolete ownership**

Delete production-only per-request FFT ownership and dead wrappers. Preserve reusable constants, log-grid/tap code, display shaping, and a minimal test reference if differential tests still require it.

Remove imports and helpers made unused by this migration; do not refactor unrelated DSP code.

**Step 3: Verify no accidental contract changes**

Run:

```powershell
npm run rust:fmt
npm run rust:clippy
npm run rust:test
npm test -- src/analysis/analysisRequestKeyFormat.test.js
```

Expected: all pass with no frontend or IPC diff.

**Step 4: Commit**

```powershell
git add src-tauri/src/dsp/spectrum.rs src-tauri/src/dsp/spectrum_bank.rs src-tauri/src/dsp/spectrum_differential.rs src-tauri/src/engine/meter_pipeline.rs
git commit -m "refactor: remove legacy spectrum transform ownership"
```

---

### Task 12: Final repository and desktop verification

**Files:**

- Modify only if verification exposes a defect directly caused by this migration.

**Step 1: Run the merge gate**

Run:

```powershell
npm run check
```

Expected: exit code 0.

**Step 2: Run file-analysis smoke**

Run:

```powershell
npm run smoke:file-analysis
```

Expected: file analysis completes with unchanged Spectrum output/history behavior.

**Step 3: Run real capture smoke**

Run:

```powershell
npm run smoke:capture
```

Expected: release capture smoke passes on the configured VB-Cable + VLC rig. A red smoke is not bypassed.

**Step 4: Record soak follow-up**

Run:

```powershell
npm run soak:capture
```

Expected: four-hour run completes or any leak/metric-drift lead is recorded for investigation. The current drift threshold is diagnostic, not automatically authoritative.

**Step 5: Inspect the final diff**

Run:

```powershell
git status --short
git diff --stat
git diff -- src/ipc src/analysis src-tauri/src/ipc
```

Expected: no unintended frontend/IPC contract changes and only plan-related untracked docs plus implementation files.

**Step 6: Commit verification-only fixes if needed**

If no fixes were needed, do not create an empty commit. If a migration defect was fixed, make one focused commit naming that defect.

## Completion checklist

- Legacy and shared differential fixtures pass at documented tolerances.
- Spectrum request keys and serialized payloads are unchanged.
- A lone Combined request still performs one transform stream per FFT size.
- Duplicate settings reuse transforms but not mutable consumer state.
- Pair topology changes never blank or reset unchanged Spectrum output.
- Live and file analysis use the same shared implementation.
- No callback-thread realtime-safety regression is introduced.
- `npm run check`, file smoke, and capture smoke pass.
- Four-hour capture soak result or follow-up is recorded before integration.
