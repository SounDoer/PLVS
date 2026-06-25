# Spectrum Y-axis Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-panel Spectrum Y-axis display controls with a better default range of `-12..-96 dB`.

**Architecture:** Store `spectrumYMaxDb` and `spectrumYRangeDb` in existing per-panel controls. Keep them frontend-only: exclude them from Spectrum analysis request keys and remap live/snapshot dB data to SVG paths in `SpectrumPanel` at render time.

**Tech Stack:** React 19, Vitest, existing panel controls persistence, existing Spectrum SVG scale helpers.

**Spec:** `docs/superpowers/specs/2026-06-25-spectrum-y-axis-range-design.md`

**Commit policy:** Do not commit during execution unless explicitly requested.

---

## File Structure

- Modify `src/lib/panelControls.js` and `src/lib/panelControls.test.js`: defaults and clamping for `spectrumYMaxDb` and `spectrumYRangeDb`.
- Modify `src/config/scales.js` and `src/config/scales.test.js`: range-aware Spectrum dB mapping and tick generation.
- Modify `src/math/spectrumMath.js`: allow path building with a supplied Y-axis range.
- Modify `src/analysis/analysisRequests.test.js`: prove Y-axis settings are excluded from request keys.
- Modify `src/components/PanelSettingsContent.jsx` and `src/components/PanelSettingsContent.test.jsx`: add `Y Max` and `Y Range` sliders below `Tilt`.
- Modify `src/components/panels/SpectrumPanel.jsx` and `src/components/panels/SpectrumPanel.test.jsx`: remap curves/grid/hover to selected Y range.

---

## Task 1: Panel Control Defaults

**Files:**
- Modify: `src/lib/panelControls.js`
- Test: `src/lib/panelControls.test.js`

- [ ] **Step 1: Add tests**

Add assertions in the existing Spectrum display controls normalization block:

```js
expect(normalizePanelControls({}).spectrumYMaxDb).toBe(-12);
expect(normalizePanelControls({}).spectrumYRangeDb).toBe(84);
expect(normalizePanelControls({ spectrumYMaxDb: -60 }).spectrumYMaxDb).toBe(-48);
expect(normalizePanelControls({ spectrumYMaxDb: 6 }).spectrumYMaxDb).toBe(0);
expect(normalizePanelControls({ spectrumYRangeDb: 42 }).spectrumYRangeDb).toBe(48);
expect(normalizePanelControls({ spectrumYRangeDb: 126 }).spectrumYRangeDb).toBe(120);
```

- [ ] **Step 2: Implement defaults and normalization**

Add defaults:

```js
spectrumYMaxDb: -12,
spectrumYRangeDb: 84,
```

Add normalizers using existing `clampNumber`:

```js
function normalizeSpectrumYMaxDb(raw) {
  return clampNumber(raw, -48, 0, DEFAULT_PANEL_CONTROLS.spectrumYMaxDb);
}

function normalizeSpectrumYRangeDb(raw) {
  return clampNumber(raw, 48, 120, DEFAULT_PANEL_CONTROLS.spectrumYRangeDb);
}
```

Return both fields from `normalizePanelControls`.

- [ ] **Step 3: Verify**

Run: `npm run test -- src/lib/panelControls.test.js`

Expected: pass.

---

## Task 2: Scale Helpers

**Files:**
- Modify: `src/config/scales.js`
- Test: `src/config/scales.test.js`

- [ ] **Step 1: Add tests**

Add tests that default Spectrum mapping is `-12..-96 dB` and that ticks include both ends:

```js
expect(spectrumDbToYViewBox(-12)).toBe(SPEC_VIEW_TOP_PAD);
expect(spectrumDbToYViewBox(-96)).toBe(SPEC_VIEW_H - SPEC_VIEW_BOTTOM_PAD);
expect(spectrumDbToYViewBox(-54)).toBeCloseTo(
  SPEC_VIEW_TOP_PAD + (SPEC_VIEW_H - SPEC_VIEW_TOP_PAD - SPEC_VIEW_BOTTOM_PAD) / 2
);
expect(buildSpectrumYTicks({ yMaxDb: -12, yRangeDb: 84 }).map((t) => t.v)).toEqual([
  -12, -24, -36, -48, -60, -72, -84, -96,
]);
```

- [ ] **Step 2: Implement helpers**

Export:

```js
export const SPEC_DB_MAX = -12;
export const SPEC_DB_RANGE = 84;
export const SPEC_DB_MIN = SPEC_DB_MAX - SPEC_DB_RANGE;
```

Update `spectrumDbToYViewBox(d, range = {})` and `spectrumDbToTopFrac(d, range = {})` to use normalized `yMaxDb` and `yRangeDb`.

Add:

```js
export function buildSpectrumYTicks(range = {}) {
  const { yMaxDb, yRangeDb } = normalizeSpectrumRange(range);
  const yMinDb = yMaxDb - yRangeDb;
  const ticks = [{ v: yMaxDb, lb: `${yMaxDb}` }];
  for (let v = yMaxDb - 12; v > yMinDb; v -= 12) ticks.push({ v, lb: `${v}` });
  ticks.push({ v: yMinDb, lb: `${yMinDb}` });
  return ticks;
}
```

Keep `SPEC_Y_TICKS = buildSpectrumYTicks()` for legacy imports.

- [ ] **Step 3: Verify**

Run: `npm run test -- src/config/scales.test.js`

Expected: pass.

---

## Task 3: Request Key Exclusion

**Files:**
- Test: `src/analysis/analysisRequests.test.js`

- [ ] **Step 1: Add test**

Add:

```js
expect(
  spectrumRequestKeyFromControls({
    ...DEFAULT_PANEL_CONTROLS,
    spectrumYMaxDb: -24,
    spectrumYRangeDb: 60,
  })
).toBe(spectrumRequestKeyFromControls(DEFAULT_PANEL_CONTROLS));
```

- [ ] **Step 2: Verify**

Run: `npm run test -- src/analysis/analysisRequests.test.js`

Expected: pass without implementation changes.

---

## Task 4: Spectrum Settings UI

**Files:**
- Modify: `src/components/PanelSettingsContent.jsx`
- Test: `src/components/PanelSettingsContent.test.jsx`

- [ ] **Step 1: Add tests**

Extend the existing Spectrum display controls test to assert labels and order:

```js
const labels = ["Peak hold", "Smoothing", "Tilt", "Y Max", "Y Range"];
expect(labels.map((label) => screen.getByText(label).textContent)).toEqual(labels);
expect(screen.getByText("-12 dB")).toBeTruthy();
expect(screen.getByText("84 dB")).toBeTruthy();
```

Also assert Spectrogram does not render `Y Max` or `Y Range`.

- [ ] **Step 2: Implement UI**

After the existing `Tilt` row, add `Y Max` and `Y Range` `SettingsSlider` rows:

```jsx
<SettingsRow label="Y Max">
  <SettingsSlider
    ariaLabel="spectrum y max"
    min={-48}
    max={0}
    step={6}
    value={effectiveYMaxDb}
    formatValue={(value) => `${value.toFixed(0)} dB`}
    onCommit={(value) => onPanelControlsChange?.(normalizePanelControls({
      ...normalizedPanelControls,
      spectrumYMaxDb: value,
    }))}
  />
</SettingsRow>
```

Use the same pattern for `Y Range` with `min={48}`, `max={120}`, `step={6}`, and `spectrumYRangeDb`.

- [ ] **Step 3: Verify**

Run: `npm run test -- src/components/PanelSettingsContent.test.jsx`

Expected: pass.

---

## Task 5: Spectrum Rendering

**Files:**
- Modify: `src/math/spectrumMath.js`
- Modify: `src/components/panels/SpectrumPanel.jsx`
- Test: `src/components/panels/SpectrumPanel.test.jsx`

- [ ] **Step 1: Update path builder**

Change:

```js
export function buildSpectrumSvgFromBandsAndDb(centers, db)
```

to:

```js
export function buildSpectrumSvgFromBandsAndDb(centers, db, range = {})
```

and call shared `spectrumDbToYViewBox(db[i], range)`.

- [ ] **Step 2: Remap in SpectrumPanel**

Compute:

```js
const spectrumRange = {
  yMaxDb: normalizedPanelControls.spectrumYMaxDb,
  yRangeDb: normalizedPanelControls.spectrumYRangeDb,
};
const spectrumYTicks = buildSpectrumYTicks(spectrumRange);
```

Build display paths from `panelSpectrumData.bands`, `dbList`, and `dbListB` with the selected range. Use Rust-provided `peakPath` as-is for peak hold until peak dB data is available; this preserves existing behavior while applying the new range to live/snapshot curves and grid.

- [ ] **Step 3: Add rendering tests**

Add tests that a live result with `smoothDb: [-12, -96]` renders a path containing top and bottom Y values, and that custom `spectrumYMaxDb: -24` changes the rendered Y position.

- [ ] **Step 4: Verify**

Run: `npm run test -- src/components/panels/SpectrumPanel.test.jsx`

Expected: pass.

---

## Task 6: Focused Verification

**Files:**
- All modified files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm run test -- src/lib/panelControls.test.js src/config/scales.test.js src/analysis/analysisRequests.test.js src/components/PanelSettingsContent.test.jsx src/components/panels/SpectrumPanel.test.jsx
```

Expected: pass.

- [ ] **Step 2: Check lints**

Use Cursor diagnostics for edited files and fix introduced issues.
