# Loudness Curve Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Momentary`, `Short-term`, and `Reference` visually distinct in the Loudness history chart while preserving theme coherence and minimal token surface.

**Architecture:** Keep chart colors theme-owned in `src/theme/builtinThemes.js` and applied through existing `--ui-chart-*` tokens. Add small trace swatches in chart-adjacent UI by reusing the same tokens already used for the rendered SVG paths. Do not add new CSS color tokens unless implementation proves existing semantic text tokens are insufficient.

**Tech Stack:** React JSX, Tailwind v4 utility classes, CSS custom properties, Vitest + Testing Library.

**Revision Note (2026-06-04):** Visual review rejected hover HUD and Layers swatches as unnecessary chrome. Current implementation should keep the hover HUD compact, avoid new swatches, keep reference text on semantic text color, and distinguish `M` / `ST` with theme sibling colors plus line width: `M` thin, `ST` thicker. The design spec and token docs are the source of truth for this revised direction.

---

## File Structure

- Modify: `src/theme/builtinThemes.js`
  - Tune loudness history live trace colors and opacity per built-in theme if visual review shows current M/ST distinction is too subtle.
- Modify: `src/theme/builtinThemes.test.js`
  - Add structural tests that every theme defines complete loudness history chart tokens and keeps `M` / `ST` live traces distinct.
- Modify: `src/components/panels/LoudnessHistoryChart.jsx`
  - Add compact line swatches to the hover HUD rows for `M` and `ST`.
  - Optionally add a reference swatch to the `Ref` label if needed.
- Modify: `src/components/panels/LoudnessHistoryChart.test.jsx`
  - Assert hover HUD swatches render and reuse chart tokens.
  - Assert optional reference swatch uses the reference token if implemented.
- Optional Modify: `src/components/PanelHeaderControls.jsx`
  - Add swatches to the `Layers` menu only after hover HUD swatches and color tuning are reviewed.
- Optional Modify: `src/components/PanelHeaderControls.test.jsx`
  - Test `Layers` swatches if the optional menu legend is implemented.

Do not commit during implementation unless the user explicitly asks for a commit.

---

### Task 1: Lock Theme Trace Token Shape

**Files:**
- Test: `src/theme/builtinThemes.test.js`
- Modify: `src/theme/builtinThemes.js` only if the test exposes missing or equal tokens

- [ ] **Step 1: Write the failing or strengthening test**

Add this test to `src/theme/builtinThemes.test.js`:

```js
it("defines distinct loudness history trace tokens for every theme", () => {
  for (const themeId of THEME_IDS) {
    const loudnessHistory = BUILTIN_THEMES[themeId].charts.loudnessHistory;

    expect(loudnessHistory.momentaryStroke).toBeTruthy();
    expect(loudnessHistory.momentaryStrokeSnap).toBeTruthy();
    expect(loudnessHistory.shortTermStroke).toBeTruthy();
    expect(loudnessHistory.shortTermStrokeSnap).toBeTruthy();
    expect(loudnessHistory.selectionStroke).toBeTruthy();
    expect(loudnessHistory.historyGridLineColor).toBeTruthy();

    expect(loudnessHistory.momentaryStroke).not.toBe(loudnessHistory.shortTermStroke);
    expect(Number(loudnessHistory.momentaryStrokeWidth)).toBeGreaterThan(0);
    expect(Number(loudnessHistory.shortTermStrokeWidth)).toBeGreaterThan(0);
    expect(Number(loudnessHistory.shortTermOpacity)).toBeGreaterThan(0);
    expect(Number(loudnessHistory.shortTermOpacity)).toBeLessThanOrEqual(1);
  }
});
```

- [ ] **Step 2: Run the theme test**

Run:

```bash
npm test -- src/theme/builtinThemes.test.js
```

Expected before implementation: the test may already pass because current themes already define all fields and distinct M/ST live colors. If it passes immediately, keep it as a strengthening regression test and continue.

- [ ] **Step 3: Tune only themes that need more M/ST separation**

If visual review confirms a theme needs stronger sibling contrast, update only that theme's `charts.loudnessHistory` values in `src/theme/builtinThemes.js`.

Candidate direction:

```js
// Keep these as sibling traces inside each theme family, not as unrelated palette jumps.
// Dark / Light: slightly separate orange vs amber/copper.
// Phosphor: green vs phosphor-green with a small lightness or chroma shift.
// Tungsten: gold vs tungsten/copper.
// Abyss: coral/red siblings, reserving cyan for snap or selection accents.
```

Do not add new token names for this task.

- [ ] **Step 4: Re-run the theme test**

Run:

```bash
npm test -- src/theme/builtinThemes.test.js
```

Expected: all tests pass.

---

### Task 2: Add Hover HUD Trace Swatches

**Files:**
- Test: `src/components/panels/LoudnessHistoryChart.test.jsx`
- Modify: `src/components/panels/LoudnessHistoryChart.jsx`

- [ ] **Step 1: Write the failing hover HUD swatch test**

Update `baseProps` in `src/components/panels/LoudnessHistoryChart.test.jsx` for a new test only by overriding props in the render call. Add:

```jsx
it("shows trace swatches in the hover HUD", () => {
  render(
    <LoudnessHistoryChart
      {...baseProps}
      loudnessHistoryVisibleLayerIds={["momentary", "shortTerm", "ref"]}
      historyHover={{
        leftPct: 30,
        topPct: 40,
        offsetLabel: "12s",
        momentary: -18.2,
        shortTerm: -20.1,
      }}
    />
  );

  expect(screen.getByLabelText("Momentary trace")).toHaveStyle({
    backgroundColor: "var(--ui-chart-momentary)",
  });
  expect(screen.getByLabelText("Short-term trace")).toHaveStyle({
    backgroundColor: "var(--ui-chart-shortterm)",
  });
});
```

- [ ] **Step 2: Run the chart test and confirm RED**

Run:

```bash
npm test -- src/components/panels/LoudnessHistoryChart.test.jsx
```

Expected: FAIL because the swatch elements do not exist yet.

- [ ] **Step 3: Add a minimal swatch helper**

In `src/components/panels/LoudnessHistoryChart.jsx`, add near the HUD constants:

```jsx
function TraceSwatch({ label, color, dashed = false }) {
  return (
    <span
      aria-label={label}
      className="inline-block h-0 w-5 shrink-0 border-t align-middle"
      style={{
        borderTopColor: color,
        borderTopWidth: 2,
        borderTopStyle: dashed ? "dashed" : "solid",
      }}
    />
  );
}
```

If Testing Library style assertions are easier with `backgroundColor`, use a 2px-high block instead:

```jsx
function TraceSwatch({ label, color }) {
  return (
    <span
      aria-label={label}
      className="inline-block h-0.5 w-5 shrink-0 rounded-full align-middle"
      style={{ backgroundColor: color }}
    />
  );
}
```

Choose one implementation and make the test match it. Prefer the line-style version if reference swatches are implemented in the same pass.

- [ ] **Step 4: Render swatches in the hover HUD**

Replace the current `M` and `ST` hover rows with rows that keep text muted but add swatches:

```jsx
<div className="flex items-center gap-1.5">
  <TraceSwatch label="Momentary trace" color="var(--ui-chart-momentary)" />
  <span>M</span>
  <span className={METRIC_NUMERIC}>
    {historyHover.momentary != null ? `${historyHover.momentary.toFixed(1)} LUFS` : "-"}
  </span>
</div>
<div className="flex items-center gap-1.5">
  <TraceSwatch label="Short-term trace" color="var(--ui-chart-shortterm)" />
  <span>ST</span>
  <span className={METRIC_NUMERIC}>
    {historyHover.shortTerm != null ? `${historyHover.shortTerm.toFixed(1)} LUFS` : "-"}
  </span>
</div>
```

- [ ] **Step 5: Run the chart test and confirm GREEN**

Run:

```bash
npm test -- src/components/panels/LoudnessHistoryChart.test.jsx
```

Expected: all tests pass.

---

### Task 3: Keep Reference Minimal

**Files:**
- Test: `src/components/panels/LoudnessHistoryChart.test.jsx`
- Modify: `src/components/panels/LoudnessHistoryChart.jsx`

- [ ] **Step 1: Decide whether a reference swatch is needed**

After Task 2, visually inspect the reference label. If the label is clear enough, skip this task and document that no additional reference UI was needed.

If it needs a stronger mapping, continue with this task.

- [ ] **Step 2: Write the failing reference swatch test**

Add:

```jsx
it("shows the reference label with an auxiliary reference swatch", () => {
  renderChart(["ref"]);

  expect(screen.getByText("Ref -23 LUFS")).toBeTruthy();
  expect(screen.getByLabelText("Reference trace")).toHaveStyle({
    borderTopColor: "var(--ui-chart-target-line)",
    borderTopStyle: "dashed",
  });
});
```

- [ ] **Step 3: Run the chart test and confirm RED**

Run:

```bash
npm test -- src/components/panels/LoudnessHistoryChart.test.jsx
```

Expected: FAIL because the reference swatch does not exist yet.

- [ ] **Step 4: Add the reference swatch without adding a text token**

Change the reference label content to:

```jsx
<div
  className={cn(
    "absolute left-[var(--ui-chart-hud-inset)] bottom-[var(--ui-chart-hud-inset)] flex items-center gap-1.5 opacity-90",
    LOUDNESS_HUD_BOX
  )}
>
  <TraceSwatch label="Reference trace" color="var(--ui-chart-target-line)" dashed />
  <span>Ref {referenceLufs} LUFS</span>
</div>
```

Do not change the text color away from the existing HUD class.

- [ ] **Step 5: Run the chart test and confirm GREEN**

Run:

```bash
npm test -- src/components/panels/LoudnessHistoryChart.test.jsx
```

Expected: all tests pass.

---

### Task 4: Optional Layers Menu Swatches

**Files:**
- Test: `src/components/PanelHeaderControls.test.jsx`
- Modify: `src/components/PanelHeaderControls.jsx`

Only run this task if hover HUD swatches are not enough.

- [ ] **Step 1: Write the failing Layers swatch test**

Add to `src/components/PanelHeaderControls.test.jsx`:

```jsx
it("renders Layers menu swatches using chart tokens", () => {
  render(
    <PanelHeaderControls
      activeTab="loudness"
      panelControls={DEFAULT_PANEL_CONTROLS}
      onPanelControlsChange={vi.fn()}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Layers" }));

  expect(screen.getByLabelText("Momentary layer trace")).toBeTruthy();
  expect(screen.getByLabelText("Short-term layer trace")).toBeTruthy();
  expect(screen.getByLabelText("Reference layer trace")).toBeTruthy();
});
```

- [ ] **Step 2: Run the header test and confirm RED**

Run:

```bash
npm test -- src/components/PanelHeaderControls.test.jsx
```

Expected: FAIL because menu swatches do not exist yet.

- [ ] **Step 3: Add optional swatch metadata locally**

In `PanelHeaderControls.jsx`, add a tiny helper that maps only loudness layer ids to existing chart tokens:

```jsx
function getLayerSwatch(optionId) {
  if (optionId === "momentary") {
    return { label: "Momentary layer trace", color: "var(--ui-chart-momentary)", dashed: false };
  }
  if (optionId === "shortTerm") {
    return { label: "Short-term layer trace", color: "var(--ui-chart-shortterm)", dashed: false };
  }
  if (optionId === "ref") {
    return { label: "Reference layer trace", color: "var(--ui-chart-target-line)", dashed: true };
  }
  return null;
}
```

Use this only when `MultiSelectChip` is rendering the `Layers` options. Do not add swatches to `Stats`.

- [ ] **Step 4: Render a compact line swatch before the option label**

Inside each option button, render the swatch between the check icon and label when metadata exists:

```jsx
{swatch ? (
  <span
    aria-label={swatch.label}
    className="inline-block h-0 w-5 shrink-0 border-t"
    style={{
      borderTopColor: swatch.color,
      borderTopWidth: 2,
      borderTopStyle: swatch.dashed ? "dashed" : "solid",
    }}
  />
) : null}
```

- [ ] **Step 5: Run the header test and confirm GREEN**

Run:

```bash
npm test -- src/components/PanelHeaderControls.test.jsx
```

Expected: all tests pass.

---

### Task 5: Final Verification

**Files:**
- Relevant modified source and test files

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- src/theme/builtinThemes.test.js src/components/panels/LoudnessHistoryChart.test.jsx src/components/PanelHeaderControls.test.jsx
```

Expected: all selected test files pass.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: no ESLint errors.

- [ ] **Step 3: Visual review each built-in theme**

Run the app:

```bash
npm run dev
```

Review:

- `Dark`
- `Light`
- `Phosphor`
- `Tungsten`
- `Abyss`

Check:

- `M` and `ST` are distinguishable.
- Neither trace reads as less important by default.
- `Reference` reads as lower-priority auxiliary context.
- Loudness does not look more colorful than Spectrum / Vectorscope.
- Hover HUD swatches map labels to traces clearly.

- [ ] **Step 4: Check docs remain aligned**

Read:

```bash
docs/superpowers/specs/2026-06-04-loudness-curve-identity-design.md
docs/design-tokens.md
```

Expected: implementation follows the documented visual semantics without introducing new token layers.

---

## Self-Review

- Spec coverage: Covers primary data trace identity, theme coherence, reference minimalism, hover swatches, optional Layers swatches, and token guidance.
- Placeholder scan: No TBD/TODO placeholders. Optional work is explicitly gated by visual need.
- Type consistency: Uses existing `loudnessHistory` theme object keys and existing `--ui-chart-*` CSS variables.
- Scope check: Focused on Loudness curve identity; does not add user customization or unrelated theme work.
