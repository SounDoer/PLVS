# Packed Per-Panel History Implementation Plan

**Status:** Memory phase implemented on `main` (2026-08-27).

**Goal:** Cut four-hour WebView history memory by packing each panel family's retained values while
preserving all 360,000 visual timestamps, the 25 Hz cadence, all 958 spectral bands, all 200
Vectorscope values, and the existing full-precision live payload.

**Architecture:** Keep Rust analysis and Tauri IPC unchanged. Encode history directly into
family-specific typed-array chunks in `FrameIntake`: centi-dB `Int16` for Spectrum, normalized
`Int16` for Vectorscope, shared packed Energy plus active packed Mode planes for Stereo Map, and
columnar typed chunks for visual Waveform metadata. Sealed chunks remain snapshot-shareable.
Spectrum and Polar Max Hold become incremental chunk summaries rather than first-snapshot full
replays.

**Tech stack:** JavaScript ES modules, typed arrays, React 19, Canvas/SVG, Vitest, Node performance
benchmarks.

**Spec:** `docs/superpowers/specs/2026-08-27-packed-panel-history-design.md`

---

## Decisions fixed by this plan

1. **No retention compromise.** Every emitted row, timestamp, frequency band, and pair value keeps
   its current place in history. Only numeric representation and object layout change.
2. **Frontend-only packing.** Rust continues publishing full-precision live and visual rows. This
   avoids changing the capture callback, shared spectral engine, or wire contract in this pass.
3. **No generic slab rewrite.** Each family keeps a metric-specific store. Small codecs and chunk
   lookup helpers may be shared; storage schemas and query indexes remain owned by the metric that
   understands them.
4. **Direct packed reads.** Canvas and indexed consumers read packed values in place. Decoding a
   selected snapshot row is allowed; decoding a retained plane or source-sized window is not.
5. **Stereo Map has two identities.** Rust measurement identity stays pair + speed + smoothing.
   Frontend Mode history identity is measurement key + Mode.
6. **Stereo Map gaps are honest.** A Mode that was not active at a timestamp resolves Missing. It
   is never reconstructed or backfilled from another Mode.
7. **Shared Stereo Map Energy.** Multiple active Modes for one measurement key share timestamps,
   band centers, Energy, frame peak, and the Rust request.
8. **Max Hold remains exact in the packed domain.** Chunk maxima and prefix merges replace replay;
   the retained suffix of a partially evicted front chunk is handled explicitly.
9. **Tests use public seams.** Codec behavior is observed through exported codecs; history behavior
   through slab/bank views; display behavior through pure render math and panel/hooks; performance
   through `storageStats()` and the benchmark report. Tests do not inspect private chunk fields.
10. **Work stays on `main`.** That is this repository's default. If isolation becomes desirable,
    ask before creating a branch or worktree.

---

## Expected four-hour result per key

| Family                              |         Current | Target before small metadata |
| ----------------------------------- | --------------: | ---------------------------: |
| Spectrum primary                    | 1,379,520,000 B |                689,760,000 B |
| Vectorscope pairs                   |   288,000,000 B |                144,000,000 B |
| Stereo Map, one Mode primary planes | 4,138,560,000 B |              1,379,520,000 B |

The benchmark must calculate these from `rows × width × bytes`, not copy literals from this table.

---

## File map

### Shared packed values and benchmark

- Create: `src/lib/packedHistoryCodecs.js`
- Create: `src/lib/packedHistoryCodecs.test.js`
- Modify: `scripts/history-perf-benchmark.mjs`
- Modify: `src/dev/historyPerformanceHarness.js`
- Modify: `src/dev/historyPerformanceHarness.test.js`

### Spectrum and Spectrogram

- Modify: `src/lib/SpectrumHistorySlab.js`
- Modify: `src/lib/SpectrumHistorySlab.test.js`
- Modify: `src/math/spectrumMaxHold.js`
- Modify: `src/math/spectrumMaxHold.test.js`
- Modify: `src/hooks/useSpectrogramCanvas.js`
- Modify: `src/hooks/useSpectrogramCanvas.test.jsx`
- Modify: `src/hooks/useSpectrogram3dCanvas.js`
- Modify: `src/math/spectrogram3dGrid.js`
- Modify: `src/math/spectrogram3dGrid.test.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`
- Modify: `src/components/panels/SpectrumPanel.jsx`
- Modify: `src/components/panels/SpectrumPanel.test.jsx`

### Vectorscope

- Modify: `src/lib/VectorscopeHistorySlab.js`
- Modify: `src/lib/VectorscopeHistorySlab.test.js`
- Modify: `src/math/vectorscopeMath.js`
- Modify: `src/math/vectorscopePersistence.js`
- Modify: `src/math/vectorscopePersistence.test.js`
- Modify: `src/math/vectorscopePolarMath.js`
- Modify: `src/math/vectorscopePolarMath.test.js`
- Modify: `src/components/panels/VectorscopePanel.jsx`
- Modify: `src/components/panels/VectorscopePanel.test.jsx`
- Modify: `src/dock/modules/DockVectorscope.jsx`
- Modify: `src/dock/modules/DockVectorscope.test.jsx`

### Stereo Map

- Modify: `src/analysis/analysisRequests.js`
- Modify: `src/analysis/analysisRequests.test.js`
- Modify: `src/dock/dockAnalysisRequest.js`
- Modify: `src/dock/dockAnalysisRequest.test.js`
- Create: `src/lib/StereoMapModeHistorySlab.js`
- Create: `src/lib/StereoMapModeHistorySlab.test.js`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`
- Modify: `src/components/panels/StereoMapPanel.jsx`
- Modify: `src/components/panels/StereoMapPanel.test.jsx`
- Modify: `src/dock/modules/DockStereoMap.jsx`
- Modify: `src/dock/modules/DockStereoMap.test.jsx`
- Keep the former primitive slab as a legacy reference/test seam; production `FrameIntake` no
  longer imports it.

### Waveform

- Create: `src/lib/WaveformVisualHistorySlab.js`
- Create: `src/lib/WaveformVisualHistorySlab.test.js`
- Modify: `src/math/spectralWaveformMath.js`
- Modify: `src/math/spectralWaveformMath.test.js`
- Modify: `src/components/panels/WaveformPanel.jsx`
- Modify: `src/components/panels/WaveformPanel.test.jsx`
- Modify: `src/dock/modules/DockWaveform.jsx`
- Modify: `src/dock/modules/DockWaveform.test.jsx`
- Modify: `src/lib/FrameIntake.js`
- Modify: `src/lib/FrameIntake.test.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`

The exact touched set may shrink when a consumer already accepts an indexed row view. It may not
grow into Rust capture/DSP/engine files without stopping and revising the approved scope.

---

## Task 0: Record the clean baseline

**Files:** no changes.

- [ ] Run the existing focused history suites:

```powershell
npx vitest run src/lib/SpectrumHistorySlab.test.js src/lib/VectorscopeHistorySlab.test.js src/lib/StereoMapHistorySlab.test.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx src/dev/historyPerformanceHarness.test.js
```

- [ ] Run `npm run benchmark:history` and retain its JSON output for comparison.
- [ ] Confirm the report still projects:
  - 144,000 scalar rows;
  - 360,000 visual rows;
  - 1,379,520,000 Spectrum primary bytes;
  - 288,000,000 Vectorscope pair bytes;
  - 4,378,840,064 total Stereo Map bytes for one four-hour key.
- [ ] Record `git status --short`; preserve unrelated user changes if any appear before
      implementation starts.

Expected: all focused tests pass. Stop and diagnose an existing failure before changing storage.

---

## Task 1: Fixed-point codec contracts

**Files:**

- Create: `src/lib/packedHistoryCodecs.js`
- Create: `src/lib/packedHistoryCodecs.test.js`

### Slice 1A — centi-dB

- [ ] Write a failing public codec test with known literals:
  - `-84.125 dB` encodes to `-8412` and decodes to `-84.12 dB`;
  - `-84.126 dB` encodes to `-8413`;
  - zero remains zero;
  - the finite endpoints do not collide with the no-value sentinel;
  - `-Infinity`/invalid round-trip to the requested semantic state.
- [ ] Run `npx vitest run src/lib/packedHistoryCodecs.test.js` and verify RED.
- [ ] Implement the smallest centi-dB codec that passes.
- [ ] Re-run and verify GREEN.

### Slice 1B — normalized signed values

- [ ] Add a failing worked-example test for `-1`, `-0.5`, `0`, `0.5`, `1`, and clamped values.
- [ ] Assert maximum round-trip error with independent literal bounds, not by repeating the codec
      formula in the expectation.
- [ ] Reserve state codes needed by Stereo Map without making ordinary Vectorscope samples pay for
      a separate state array.
- [ ] Run RED, implement, then run GREEN.

### Slice 1C — Stereo Map Mode states

- [ ] Add failing tests for finite Position/Correlation, finite dB modes, invalid, `-Infinity`, and
      `+Infinity`.
- [ ] Implement Mode-specific state/code mapping with finite domains covering Mono Loss `[-60, 0]`
      and M/S Ratio `[-96, +48]`.
- [ ] Verify no finite UI-domain value aliases a reserved state.

Do not add storage classes in this task. The codec module is the agreed numerical seam.

---

## Task 2: Make Spectrum history packed

**Files:**

- Modify: `src/lib/SpectrumHistorySlab.js`
- Modify: `src/lib/SpectrumHistorySlab.test.js`
- Modify: `scripts/history-perf-benchmark.mjs`

### Slice 2A — one packed row

- [ ] Add a failing `SpectrumHistorySlab` test that pushes a known primary/secondary row and reads
      it back through the public history-row interface.
- [ ] Assert decoded values stay within 0.005 dB, absent secondary remains absent, bands/timestamp
      are unchanged, and no full decoded plane is stored by the public diagnostics.
- [ ] Run the slab suite and verify RED.
- [ ] Replace chunk `Float32Array` dB planes with `Int16Array` and encode directly into the chunk.
- [ ] Expose indexed primary/secondary dB reads and an explicit selected-row decode operation.
- [ ] Run GREEN.

### Slice 2B — wrap, freeze, and bytes

- [ ] Add one failing behavior test covering a partial front chunk, a frozen snapshot, and later
      live appends/eviction.
- [ ] Assert the frozen row values and timestamps remain unchanged.
- [ ] Extend public `storageStats()` to report packed plane types plus allocated/used bytes.
- [ ] Add a four-hour arithmetic assertion for 689,760,000 primary-plane bytes.
- [ ] Implement only the chunk/freeze changes required to pass, including copying only used tail
      rows.

### Slice 2C — benchmark report

- [ ] Add a failing benchmark/harness test expecting current and packed Spectrum projections side
      by side, with row and band counts unchanged.
- [ ] Update the benchmark projection and full-visual allocator to use the packed slab.
- [ ] Keep the old byte figure in a named baseline field so future reports show the reduction
      rather than erasing history.

Focused gate:

```powershell
npx vitest run src/lib/packedHistoryCodecs.test.js src/lib/SpectrumHistorySlab.test.js src/dev/historyPerformanceHarness.test.js
npm run benchmark:history
```

---

## Task 3: Adapt Spectrum/Spectrogram consumers and make Max Hold incremental

**Files:** Spectrum consumer files from the file map.

### Slice 3A — 2D Spectrogram direct packed reads

- [ ] Add a failing `paintSpectrogramImageData` test using a real frozen packed Spectrum slab and a
      small known image.
- [ ] Compare its pixels with a literal reference image produced from the same known dB values;
      allow at most one LUT step at a quantization boundary.
- [ ] Adapt `paintSpan` and hover reads to indexed packed dB access.
- [ ] Verify the test passes without a decoded-row allocation counter increasing.

### Slice 3B — 3D grid direct packed reads

- [ ] Add a failing `sampleWaterfallGrid` differential test using a real packed view.
- [ ] Adapt the grid sampler to the same indexed dB seam.
- [ ] Run the 3D grid and canvas suites; rendered ridge count, timestamps, and selected row must not
      change.

### Slice 3C — Spectrum snapshot row

- [ ] Add a failing `useSnapshot` test proving one selected packed row produces the same path/data
      within the approved coordinate tolerance.
- [ ] Decode only that row into reusable result data; cache by frozen view, key, and selected
      timestamp as today.
- [ ] Adapt `SpectrumPanel` only where its snapshot result shape requires it; live behavior stays on
      the full-precision live result.

### Slice 3D — incremental Max Hold

- [ ] Add a failing randomized differential test: for several selected rows, packed slab
      `maxHoldAt(index)` must equal a literal full replay over decoded quantized rows.
- [ ] Cover a partially evicted front chunk so expired maxima cannot leak into the result.
- [ ] Implement per-chunk encoded maxima and bounded target/front scans.
- [ ] Expose query stats and assert scanned rows are bounded by partial chunks, not retained length.
- [ ] Replace `useSnapshot`'s lazy full-history `buildSpectrumMaxHoldTable` path with the slab query.
- [ ] Retain a compatibility fallback only for plain-array test fixtures; production packed views
      must take the indexed path.

Focused gate:

```powershell
npx vitest run src/lib/SpectrumHistorySlab.test.js src/math/spectrumMaxHold.test.js src/hooks/useSpectrogramCanvas.test.jsx src/math/spectrogram3dGrid.test.js src/hooks/useSnapshot.test.jsx src/components/panels/SpectrumPanel.test.jsx
```

Manual checkpoint: use the history harness at `?historyPerf=240m`; inspect 2D/3D Spectrogram and a
snapshot Spectrum at default and narrow frequency ranges before starting Vectorscope.

---

## Task 4: Make Vectorscope history packed

**Files:** Vectorscope slab and consumer files from the file map.

### Slice 4A — packed slab behavior

- [ ] Add a failing slab test with known pairs including `-1`, `-0.5`, `0`, `0.5`, and `1`.
- [ ] Assert decoded error is at most `1 / (2 × 32767)`, scalar metrics/timestamps are unchanged,
      and row count/pair count remain exact.
- [ ] Replace chunk pair planes with `Int16Array`, encoded directly on append.
- [ ] Provide indexed pair reads and an explicit selected-row decode method.
- [ ] Extend `storageStats()` and assert 144,000,000 four-hour pair bytes.
- [ ] Cover wrap/freeze/post-freeze append with a real packed view.

### Slice 4B — Lissajous and Persistence

- [ ] Add failing pure-math differential tests that feed real packed rows to path construction,
      recent-window selection, radius calculation, and canvas drawing.
- [ ] Adapt loops to read scaled signed integers directly; do not allocate decoded arrays per row.
- [ ] Keep plain arrays supported where they are part of existing public math tests.
- [ ] Update Workspace and Dock panels to redraw on the same history version and preserve their
      existing live-result path.

### Slice 4C — Polar Sample and Polar Level

- [ ] Add failing differential tests for packed rows across the four quadrants, silence, clipping,
      and the signal floor.
- [ ] Adapt projection/binning to indexed packed values.
- [ ] Assert the 260-unit plot displacement is below 0.005 units for representative rows.

Focused gate:

```powershell
npx vitest run src/lib/VectorscopeHistorySlab.test.js src/math/vectorscopePersistence.test.js src/math/vectorscopePolarMath.test.js src/components/panels/VectorscopePanel.test.jsx
```

---

## Task 5: Add incremental Polar Max Hold

**Files:**

- Modify: `src/lib/VectorscopeHistorySlab.js`
- Modify: `src/lib/VectorscopeHistorySlab.test.js`
- Modify: `src/math/vectorscopePolarMath.js`
- Modify: `src/math/vectorscopePolarMath.test.js`
- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/hooks/useSnapshot.test.jsx`

- [ ] Add a failing randomized differential test comparing `polarMaxHoldAt(index)` with the current
      full replay at early, chunk-boundary, middle, and latest rows.
- [ ] Add a partially evicted front-chunk case.
- [ ] Implement one 64-bin maximum summary per sealed chunk and bounded checkpoints/tail replay.
- [ ] Expose `mergedChunks`, `mergedCheckpoints`, and `scannedRows` query stats.
- [ ] Assert retained-history growth increases merged summaries but not the row-scan bound.
- [ ] Route packed production views through the incremental query in `useSnapshot`; retain plain
      fixture compatibility.
- [ ] Remove the production dependency on building a 360,000-row Polar prefix table at snapshot
      entry/first use.

Focused gate:

```powershell
npx vitest run src/lib/VectorscopeHistorySlab.test.js src/math/vectorscopePolarMath.test.js src/hooks/useSnapshot.test.jsx
```

---

## Task 6: Derive Stereo Map Mode retention without changing Rust requests

**Files:**

- Modify: `src/analysis/analysisRequests.js`
- Modify: `src/analysis/analysisRequests.test.js`
- Modify: `src/dock/dockAnalysisRequest.js`
- Modify: `src/dock/dockAnalysisRequest.test.js`

### Public result shape

Keep the existing `stereoMap` measurement-key `Set` and add:

```text
stereoMapModes: Map<measurementKey, Set<Mode>>
```

This avoids breaking the family eviction contract and gives the frontend bank the Mode set it
needs. `deriveAnalysisRequests` and the Rust request payload stay unchanged.

- [ ] Add a failing analysis test proving two panels with one measurement key and two Modes produce:
  - one Rust Stereo Map request;
  - one retained measurement key;
  - two retained frontend Modes.
- [ ] Add failing tests for identical-Mode deduplication, over-cap panels, unavailable channels,
      panels absent from the tree, and a Mode change.
- [ ] Implement the workspace derivation without importing `workspace/registry.jsx`.
- [ ] Add failing Dock merge tests proving Workspace and Dock Modes union under the same measurement
      key without duplicating the Rust request.
- [ ] Implement the Dock merge and run GREEN.

Focused gate:

```powershell
npx vitest run src/analysis/analysisRequests.test.js src/dock/dockAnalysisRequest.test.js
```

---

## Task 7: Introduce the packed Stereo Map history bank

**Files:**

- Create: `src/lib/StereoMapHistoryBank.js`
- Create: `src/lib/StereoMapHistoryBank.test.js`
- Reuse pure derivation/Hold helpers from `src/math/stereoMapMath.js` and
  `src/math/stereoMapHold.js`.

### Slice 7A — one Mode, one row

- [ ] Add a failing bank test that appends one full-precision primitive row while Position is
      retained, then reads Position, Energy, opacity/gate inputs, timestamp, and band centers through
      `viewForMode(position)`.
- [ ] Compare against `deriveStereoMapRow` with the approved numeric tolerances.
- [ ] Assert `viewForMode(correlation)` reports no available row.
- [ ] Implement one shared Energy/frame-peak timeline and one packed Position plane. Normalize the
      primitive row once and write directly into both destination planes.

### Slice 7B — multiple Modes share common data

- [ ] Add a failing test with Position and Correlation active under one measurement key.
- [ ] Assert both views share timestamp/grid/Energy storage according to public `storageStats()`,
      while their values and Hold summaries remain independent.
- [ ] Extend the append pass to derive all active Modes after one normalization/gate pass.

### Slice 7C — Mode gaps and lifecycle

- [ ] Add a failing sequence test:
  - Position rows at 0 and 40 ms;
  - switch retained Modes to Correlation;
  - Correlation rows at 80 ms and after the 3,000 ms eviction grace has elapsed;
  - Correlation is Missing at 40 ms;
  - the live Position plane is gone after its grace expires;
  - a frozen Position snapshot remains readable.
- [ ] Implement per-Mode availability and grace-period plane eviction without deleting shared
      Energy while the measurement key remains retained.
- [ ] Preserve exact capacity, Clear, incompatible grid/sample-rate, and timestamp behavior.

### Slice 7D — Mode-specific Hold and memory

- [ ] Add failing differential tests for Position min/max, Correlation min, Mono Loss min, and M/S
      Ratio max at selected rows.
- [ ] Cover invalid/gated/infinite points and the partially retained front chunk.
- [ ] Implement packed per-Mode summaries/checkpoints.
- [ ] Add public allocated/used byte diagnostics for shared and per-Mode planes.
- [ ] Assert the one-Mode four-hour primary formula is 1,379,520,000 bytes and two/four Mode formulas
      scale only by one additional two-byte value plane per Mode.

Focused gate:

```powershell
npx vitest run src/lib/packedHistoryCodecs.test.js src/lib/StereoMapHistoryBank.test.js src/math/stereoMapMath.test.js src/math/stereoMapHold.test.js
```

---

## Task 8: Migrate FrameIntake, snapshot, Workspace, and Dock to the bank

**Files:** Stereo Map integration files from the file map.

### Slice 8A — FrameIntake

- [ ] Add a failing `FrameIntake` test proving one primitive input row becomes only the retained
      Mode planes and one shared Energy row.
- [ ] Pass `stereoMapModes` through `setRetainedVisualKeys` and append into one bank per measurement
      key.
- [ ] Change the public lookup to accept Mode:

```text
getVisualStereoMapHistByKey(measurementKey, mode)
```

- [ ] Freeze banks by measurement key while preserving per-Mode gaps.
- [ ] Port existing capacity-change, eviction, reset, multiple-key, snapshot immutability, and
      timestamp tests before removing the primitive slab.

### Slice 8B — useSnapshot

- [ ] Add a failing hook test proving a retained Position row resolves, an unretained Correlation
      row at the same timestamp returns Missing, and Y-range changes reproject the stored unclipped
      value without minting history.
- [ ] Resolve the selected Mode view from the frozen bank and reconstruct points/hover Energy from
      packed value + Energy + frame peak.
- [ ] Query only that Mode's Hold index when requested.

### Slice 8C — panels

- [ ] Add failing Workspace and Dock panel tests proving live data still comes from the full-precision
      `displayAudio` result while live Hold lookup is Mode-specific.
- [ ] Update the getter calls with `mode` and keep two panels on the same measurement key sharing one
      bank.
- [ ] Verify switching Mode exits snapshot through the existing control path and older unavailable
      Mode history shows the existing Snapshot empty state.

### Slice 8D — retire primitive history

- [ ] Exact-grep production imports/usages of `StereoMapHistorySlab`.
- [ ] Delete the old primitive slab and its tests only after every behavior has a bank equivalent.
- [ ] Update benchmark and harness imports to the bank.
- [ ] Assert no retained `pl`, `pr`, or `c` plane appears in production `storageStats()`.

Focused gate:

```powershell
npx vitest run src/lib/StereoMapHistoryBank.test.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx src/components/panels/StereoMapPanel.test.jsx src/dock/modules/DockStereoMap.test.jsx src/dev/historyPerformanceHarness.test.js
```

Manual checkpoint: with two Stereo Map panels sharing measurement controls but using different
Modes, verify one Rust request, two live displays, correct independent Holds, and explicit Missing
before each Mode's first retained row.

---

## Task 9: Move visual Waveform history to columnar chunks

**Files:** Waveform files from the file map.

### Slice 9A — production-shape diagnostics

- [ ] Add a failing `WaveformVisualHistorySlab` test that appends two-channel waveform minima,
      maxima, dominant frequency, centroid, tonality, and timestamp.
- [ ] Define the public view and `storageStats()` from the observed wire types and channel count.
- [ ] Use Float32 columns for Rust `f32` fields and Float64 timestamps; do not reduce row count or
      omit inactive visual fields.
- [ ] Assert exact values against `Math.fround` literals where the wire source is Float32.

### Slice 9B — wrap and snapshot

- [ ] Add a failing wrap/freeze/post-freeze append test.
- [ ] Implement immutable sealed chunks and used-tail copying.
- [ ] Verify `freeze()` returns a lazy view rather than a 360,000-reference array.

### Slice 9C — spectral Waveform math

- [ ] Add a failing differential test comparing `sliceSpectralWaveformMetrics` over legacy rows and
      the packed slab for the same timestamps/window/buckets.
- [ ] Adapt the math to indexed column reads without materializing row objects.
- [ ] Keep output and gap behavior unchanged.

### Slice 9D — integration

- [ ] Replace `_visualWaveformHist` in `FrameIntake` with the new slab.
- [ ] Make `useSnapshot` freeze/share the slab directly instead of `snapshotRows(...toArray())`.
- [ ] Run Workspace and Dock Waveform tests for live, snapshot, scrolling, spectral color,
      centroid, and hover behavior.
- [ ] Extend the benchmark with allocated/used visual Waveform bytes and frozen copied-tail bytes.

Focused gate:

```powershell
npx vitest run src/lib/WaveformVisualHistorySlab.test.js src/math/spectralWaveformMath.test.js src/lib/FrameIntake.test.js src/hooks/useSnapshot.test.jsx src/components/panels/WaveformPanel.test.jsx src/dock/modules/DockWaveform.test.jsx
```

---

## Task 10: Consolidate the four-hour benchmark and harness

**Files:** benchmark/harness files from the file map.

- [ ] Add failing structural tests for a mixed production layout with one Spectrum/Spectrogram key,
      one Vectorscope key, and one one-Mode Stereo Map measurement key.
- [ ] Report baseline and packed bytes separately for every plane and key.
- [ ] Assert exact row widths and counts before asserting bytes, so a silent precision/cadence cut
      cannot make the memory test pass.
- [ ] Add one-, two-, and four-Mode Stereo Map projections with shared Energy counted once.
- [ ] Report append time per family and mixed layout, not only one aggregate.
- [ ] Report Spectrum/Polar/Stereo Map Hold query summaries and scanned-row bounds.
- [ ] Report snapshot shared bytes and used-tail copied bytes.
- [ ] Update `benchmark:history:full` to allocate packed production history. Keep it opt-in and guard
      it with an explicit memory warning.
- [ ] Run the safe benchmark three times and retain results for the implementation handoff.

Expected structural outcomes:

- Spectrum primary packed bytes: 689,760,000.
- Vectorscope pair packed bytes: 144,000,000.
- One-Mode Stereo Map shared Energy + Mode bytes: 1,379,520,000.
- Visual rows: 360,000 for every continuously active family.
- Spectrum/Stereo Map bands: 958.
- Vectorscope values: 200.
- No full-history decode/materialization counter increments during a canvas-sized query or one-row
  snapshot.

---

## Task 11: Final verification

- [ ] Run all focused suites named above together.
- [ ] Run `npm run benchmark:history` and compare with the Task 0 baseline.
- [ ] Run `npm run check` as the merge gate.
- [ ] Run the desktop developer harness at 240 minutes and manually verify:
  - live Spectrum and both Spectrogram modes;
  - Vectorscope Lissajous/Persistence/Polar;
  - all four Stereo Map Modes, including Mode gaps;
  - Waveform spectral overlays;
  - snapshot entry, scrubbing, Hold, hover, exit-to-live, and Clear.
- [ ] Run a real `npm run soak:capture` four-hour session before declaring the memory objective
      achieved. The capture layer is unchanged, so a red soak is evidence to investigate rather than a
      release-gate verdict; compare RSS plateau, WebView CPU, UI responsiveness, and snapshot latency
      with the original overnight report.
- [ ] Record final measured results in the spec or a short results document. Do not replace measured
      figures with projections.

---

## Stop conditions

Stop and return to design review instead of widening scope if any of these occurs:

- a packed consumer requires changing the Rust IPC payload;
- visual differential tests cannot meet the approved tolerance without storing another plane;
- Stereo Map Mode gaps conflict with an existing user-visible workflow not captured in the spec;
- multiple active Modes duplicate Energy or Rust requests;
- packed append introduces per-row temporary arrays or materially worsens frame-time distribution;
- full-history decode is needed by a current canvas/panel interface;
- the four-hour row/band/pair counts change;
- capture smoke becomes red and the rig cannot be repaired.

The response to a stop condition is a focused spec amendment, not an unreviewed fallback to lower
cadence, shorter history, fewer bands, or a broader Rust rewrite.
