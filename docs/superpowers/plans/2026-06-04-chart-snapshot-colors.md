# Chart Snapshot Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chart snapshot mode visually obvious and theme-consistent across Loudness, Vectorscope, and Spectrum without adding new token names.

**Architecture:** Keep snapshot colors owned by `src/theme/builtinThemes.js` and continue applying them through the existing `--ui-chart-*-snap` CSS variables in `applyThemeToDocument()`. Add theme-level regression tests that encode the intended token relationships: each theme has one snapshot family, snap colors differ clearly from live colors, and Loudness `M` / `ST` may remain sibling traces within that family.

**Tech Stack:** React JSX chart consumers, CSS custom properties, theme objects in plain JavaScript, Vitest.

---

## File Structure

- Modify: `src/theme/builtinThemes.test.js`
  - Strengthen built-in theme tests for snapshot trace completeness, live/snap distance, and within-theme snapshot family consistency.
- Modify: `src/theme/builtinThemes.js`
  - Tune only built-in chart snap colors that fail the new constraints or look too close to live traces.
- Verify only: `src/preferences/applyDocumentTheme.js`
  - Confirm existing `--ui-chart-*-snap` variable writing remains unchanged.
- Verify only: `src/components/panels/LoudnessHistoryChart.jsx`
  - Confirm `selectedOffset >= 0` continues switching Loudness traces to snap tokens.
- Verify only: `src/components/panels/VectorscopePanel.jsx`
  - Confirm `selectedOffset >= 0` continues switching the vectorscope path to its snap token.
- Verify only: `src/components/panels/SpectrumPanel.jsx`
  - Confirm `selectedOffset >= 0` continues switching spectrum stroke/fill to snap tokens.
- Verify only: `docs/superpowers/specs/2026-06-04-chart-snapshot-color-design.md`
  - Use as the design source of truth.
- Verify only: `docs/design-tokens.md`
  - Confirm token documentation stays aligned with the implementation.

Do not add new CSS variable names. Do not change Spectrogram behavior in this pass. Do not commit during implementation unless the user explicitly asks for a commit.

---

### Task 1: Lock Snapshot Token Invariants

**Files:**
- Test: `src/theme/builtinThemes.test.js`

- [ ] **Step 1: Add snapshot helper functions**

In `src/theme/builtinThemes.test.js`, keep the existing `hexToRgb()` and `colorDistance()` helpers. Add these helpers below `colorDistance()`:

```js
function expectHexColor(value) {
  expect(value).toMatch(/^#[0-9a-f]{6}$/i);
}

function getSnapshotTokens(themeId) {
  const charts = BUILTIN_THEMES[themeId].charts;
  return {
    momentaryLive: charts.loudnessHistory.momentaryStroke,
    momentarySnap: charts.loudnessHistory.momentaryStrokeSnap,
    shortTermLive: charts.loudnessHistory.shortTermStroke,
    shortTermSnap: charts.loudnessHistory.shortTermStrokeSnap,
    vectorscopeLive: charts.vectorscope.strokeLive,
    vectorscopeSnap: charts.vectorscope.strokeSnap,
    spectrumLive: charts.spectrum.strokeLive,
    spectrumSnap: charts.spectrum.strokeSnap,
  };
}
```

- [ ] **Step 2: Add a failing/strengthening snapshot family test**

Add this test inside `describe("BUILTIN_THEMES", () => { ... })`:

```js
it("defines one visually distinct chart snapshot family for every theme", () => {
  for (const themeId of THEME_IDS) {
    const tokens = getSnapshotTokens(themeId);

    for (const value of Object.values(tokens)) {
      expectHexColor(value);
    }

    expect(tokens.momentarySnap).toBe(tokens.vectorscopeSnap);
    expect(tokens.momentarySnap).toBe(tokens.spectrumSnap);

    expect(colorDistance(tokens.momentaryLive, tokens.momentarySnap)).toBeGreaterThanOrEqual(45);
    expect(colorDistance(tokens.shortTermLive, tokens.shortTermSnap)).toBeGreaterThanOrEqual(45);
    expect(colorDistance(tokens.vectorscopeLive, tokens.vectorscopeSnap)).toBeGreaterThanOrEqual(45);
    expect(colorDistance(tokens.spectrumLive, tokens.spectrumSnap)).toBeGreaterThanOrEqual(45);

    expect(tokens.shortTermSnap).not.toBe(tokens.momentarySnap);
    expect(colorDistance(tokens.shortTermSnap, tokens.momentarySnap)).toBeGreaterThanOrEqual(25);
    expect(colorDistance(tokens.shortTermSnap, tokens.momentarySnap)).toBeLessThanOrEqual(120);
  }
});
```

This does not claim to validate aesthetics completely. It prevents the known regression where snapshot colors are barely different from live colors or unrelated across chart panels.

- [ ] **Step 3: Run the theme test and confirm the current failures**

Run:

```bash
npm test -- src/theme/builtinThemes.test.js
```

Expected: FAIL if any current theme has snap colors too close to live colors. At minimum, check Light and Tungsten carefully because their existing snap choices are subtle.

---

### Task 2: Tune Built-In Snapshot Colors

**Files:**
- Modify: `src/theme/builtinThemes.js`

- [ ] **Step 1: Update only chart snap fields**

In `src/theme/builtinThemes.js`, change only these fields when needed:

```js
momentaryStrokeSnap
shortTermStrokeSnap
vectorscope.strokeSnap
spectrum.strokeSnap
```

Do not change live trace colors, stroke widths, opacity, selection stroke, meter colors, semantic colors, or target/reference line colors for this task.

- [ ] **Step 2: Apply the theme directions**

Use these values as the first implementation pass:

```js
// Dark: keep existing gold / pale amber snapshot family.
momentaryStrokeSnap: "#fcd34d";
shortTermStrokeSnap: "#f2b27a";
vectorscope.strokeSnap: "#fcd34d";
spectrum.strokeSnap: "#fcd34d";

// Light: stronger warm ochre family for light backgrounds.
momentaryStrokeSnap: "#b76b00";
shortTermStrokeSnap: "#7a5a18";
vectorscope.strokeSnap: "#b76b00";
spectrum.strokeSnap: "#b76b00";

// Phosphor: keep existing pale phosphor family.
momentaryStrokeSnap: "#9ed4aa";
shortTermStrokeSnap: "#6db87e";
vectorscope.strokeSnap: "#9ed4aa";
spectrum.strokeSnap: "#9ed4aa";

// Tungsten: bright tungsten gold family.
momentaryStrokeSnap: "#ffd060";
shortTermStrokeSnap: "#f4b84a";
vectorscope.strokeSnap: "#ffd060";
spectrum.strokeSnap: "#ffd060";

// Abyss: keep existing cyan / teal snapshot family.
momentaryStrokeSnap: "#28c4cc";
shortTermStrokeSnap: "#1a9098";
vectorscope.strokeSnap: "#28c4cc";
spectrum.strokeSnap: "#28c4cc";
```

If a value fails the test, adjust the smallest number of colors needed. Keep `momentary`, `vectorscope`, and `spectrum` snap colors equal within a theme. Keep `shortTermStrokeSnap` close enough to read as a sibling, but not identical.

- [ ] **Step 3: Run the theme test**

Run:

```bash
npm test -- src/theme/builtinThemes.test.js
```

Expected: PASS.

---

### Task 3: Verify Existing Token Flow

**Files:**
- Verify: `src/preferences/applyDocumentTheme.js`
- Verify: `src/components/panels/LoudnessHistoryChart.jsx`
- Verify: `src/components/panels/VectorscopePanel.jsx`
- Verify: `src/components/panels/SpectrumPanel.jsx`

- [ ] **Step 1: Search for snapshot token consumers**

Run:

```bash
rg "momentaryStrokeSnap|shortTermStrokeSnap|strokeSnap|--ui-chart-.*-snap|selectedOffset >= 0" src
```

Expected:

- `applyThemeToDocument()` writes the existing snap variables.
- `LoudnessHistoryChart` switches `M` and `ST` strokes to snap variables when `selectedOffset >= 0`.
- `VectorscopePanel` switches path and center fill to `--ui-chart-vectorscope-snap`.
- `SpectrumPanel` switches path and fill gradient to `--ui-chart-spectrum-snap`.

- [ ] **Step 2: Leave token names unchanged**

Confirm no new variable names were added. The implementation must keep using:

```css
--ui-chart-momentary-snap
--ui-chart-shortterm-snap
--ui-chart-vectorscope-snap
--ui-chart-spectrum-snap
```

Expected: no source edits are needed in this task. If the search shows a chart bypassing the existing snap token, stop and update this plan before implementing a rendering change.

---

### Task 4: Focused Verification

**Files:**
- Test: `src/theme/builtinThemes.test.js`
- Verify changed frontend files

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/theme/builtinThemes.test.js src/preferences/themeResolve.test.js src/theme/themeFallbacks.test.js
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run the app for visual review**

Run:

```bash
npm run dev
```

Expected: app starts successfully.

Review snapshot state in:

- `Dark`
- `Light`
- `Phosphor`
- `Tungsten`
- `Abyss`

For each theme, check:

- Loudness, Vectorscope, and Spectrum all clearly read as snapshot mode.
- Snapshot color is more obvious than a minor brightness tweak.
- Snapshot color still feels native to the active theme.
- Loudness `M` and `ST` snap traces read as siblings, not unrelated categories.
- Snapshot color does not conflict with Reference / target / threshold semantics.
- Non-chart UI such as transport buttons, status pills, and footer status text is unchanged.

---

### Task 5: Documentation Alignment

**Files:**
- Verify: `docs/superpowers/specs/2026-06-04-chart-snapshot-color-design.md`
- Verify: `docs/design-tokens.md`

- [ ] **Step 1: Re-read the design source of truth**

Read:

```bash
docs/superpowers/specs/2026-06-04-chart-snapshot-color-design.md
```

Expected: implementation follows the stated goals and non-goals, especially no new token names and no Spectrogram behavior change.

- [ ] **Step 2: Re-read token documentation**

Read:

```bash
docs/design-tokens.md
```

Expected: the chart token section describes snapshot colors as selected-historical-data state colors and lists the same token names used by the implementation.

- [ ] **Step 3: Update docs only if implementation changed the design**

If the implementation had to deviate from the spec, update the smallest relevant passage in the spec or token docs. If the implementation follows the current docs, make no documentation edits in this task.

---

## Self-Review

- Spec coverage: Covers the snapshot family model, built-in theme alignment, existing token names, chart consumers, no Spectrogram behavior change, and visual review expectations.
- Placeholder scan: No placeholder markers remain. Each task has concrete file paths, commands, expected results, and code snippets where implementation is needed.
- Type consistency: Uses existing `loudnessHistory.momentaryStrokeSnap`, `loudnessHistory.shortTermStrokeSnap`, `vectorscope.strokeSnap`, `spectrum.strokeSnap`, and existing `--ui-chart-*-snap` variables throughout.
- Scope check: Focused on chart snapshot colors only. Does not add configurability, new tokens, or unrelated UI changes.
