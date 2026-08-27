# Frontend Panel CPU Implementation Plan

**Status:** In progress on `main` (2026-08-27).

**Goal:** Remove panel-owned idle polling and repeated unchanged drawing without changing history
retention, precision, cadence, or visible Live responsiveness.

**Spec:** `docs/superpowers/specs/2026-08-27-frontend-panel-cpu-design.md`

## Decisions fixed by this plan

1. History ingestion never depends on whether a panel is visible or drawing.
2. Visible Live panels remain data-driven; no fixed-rate throttle is introduced.
3. Static Snapshot and fullscreen-covered panel instances may settle to zero drawing work.
4. The first implementation target is the proven permanent Spectrogram rAF polling.
5. Vectorscope, Spectrum, Stereo Map, and Waveform changes require panel-local measurements first.
6. Work lands directly on `main`.

## Task 1: Pin scheduling behavior with tests

- [ ] Extend the 2D hook test to assert that a callback never schedules its own successor.
- [ ] Cover source-version invalidation, duplicate input, hidden state, reveal, and canvas resize.
- [ ] Add equivalent scheduling coverage for the 3D hook at its public hook boundary.
- [ ] Preserve existing pixel/output tests.

Run:

```bash
npx vitest run src/hooks/useSpectrogramCanvas.test.jsx src/hooks/useSpectrogram3dCanvas.test.jsx
```

## Task 2: Add opt-in CPU diagnostics

- [ ] Add a development-only aggregate collector with enable, reset, record, and snapshot behavior.
- [ ] Test disabled no-op behavior and aggregate counter/timing output.
- [ ] Instrument Spectrogram invalidation, cancellation, attempt, skip, and paint boundaries.
- [ ] Avoid per-frame records and avoid a global publication that can rerender the app.

## Task 3: Convert Spectrogram to one-shot invalidation

- [ ] Pass live/frozen source `version` explicitly from `SpectrogramPanel`.
- [ ] Use `useCanvasSize`'s callback to increment a canvas size revision.
- [ ] Pass `panelVisible` to both renderer hooks.
- [ ] Replace each permanent rAF loop with one scheduled callback per dirty input set.
- [ ] Keep the complete paint signatures as correctness guards.
- [ ] Ensure inactive mode hooks using `NO_CANVAS` remain idle.

Run:

```bash
npx vitest run src/hooks/useSpectrogramCanvas.test.jsx src/hooks/useSpectrogram3dCanvas.test.jsx src/components/panels/SpectrogramPanel.test.jsx
```

## Task 4: Measure the remaining panel families

- [ ] Add render/derive/paint timings around Vectorscope persistence and Polar selection.
- [ ] Add derive timings around Spectrum display snapshot, hold, path, and peak-label work.
- [ ] Add derive timings around Stereo Map row conversion and hold reads.
- [ ] Confirm Waveform's visibility and one-shot drawing behavior with counters.
- [ ] Record one-minute Live and static-Snapshot reports at representative panel sizes.

## Task 5: Implement only measured hotspots

- [ ] Cache Vectorscope history-window selection by slab version if it is material.
- [ ] Move Vectorscope persistence to visibility-aware one-shot drawing if repeated unchanged work
      remains material.
- [ ] Cache Spectrum subresults by analysis-result identity and viewport if material.
- [ ] Cache Stereo Map derivation by live-row identity, mode, and range if material.
- [ ] Add focused equivalence and invalidation tests for each accepted cache.

This task is intentionally conditional. A family with negligible measured cost receives no code
change.

## Task 6: Verification

- [ ] Run `git diff --check`.
- [ ] Run focused Spectrogram and any later panel suites.
- [ ] Run `npm run check`.
- [ ] Manually verify all Spectrogram modes, Live/Snapshot, fullscreen, resize, DPI, theme, scrub,
      Clear, and source restart.
- [ ] Run `npm run soak:capture` for the real four-hour comparison; treat drift results as leads,
      per repository guidance.

## Commit strategy

1. `docs: specify frontend panel cpu scheduling`
2. `test: pin spectrogram invalidation scheduling`
3. `perf: stop idle spectrogram animation polling`
4. `perf: cache measured panel derivations` (only if measurement justifies it)
5. `test: report panel cpu counters`

## Completion checklist

- [ ] No Spectrogram callback self-schedules.
- [ ] Static Snapshot and covered workspace Spectrograms settle to zero callback activity.
- [ ] Every relevant Live source version can trigger the next paint.
- [ ] History and analysis pipelines are untouched.
- [ ] Remaining panel work is backed by measurements.
- [ ] Focused suites and full merge gate pass.
