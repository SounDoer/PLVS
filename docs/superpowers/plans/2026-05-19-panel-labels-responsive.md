# Panel Labels: Structural Alignment & Responsive Compact Behavior — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove hardcoded spacer CSS vars from Peak/Vectorscope panels, replace with structurally-derived alignment, and add container-query-based hiding so labels degrade gracefully at narrow panel widths.

**Architecture:** Three independent edits — (1) delete dead preference vars, (2) update each panel component's JSX in isolation, (3) clean up the shared `compact` prop callsite. Each task commits independently and leaves the app working.

**Tech Stack:** React (JSX), Tailwind v4 (container queries built-in), CSS custom properties via `applyLayoutToDocument`.

**Spec:** `docs/superpowers/specs/2026-05-19-panel-labels-responsive-design.md`

---

### Task 1: Delete dead CSS vars from preferences

**Files:**
- Modify: `src/preferences/data.js`
- Modify: `src/preferences/applyDocumentTheme.js`

- [ ] **Step 1: Delete `tpInfoLeftBlank` and `corrInfoLeftBlank` from `data.js`**

In `src/preferences/data.js`, inside `layout.spacingRem`, remove the two lines:

```js
// DELETE these two lines (around line 50-53):
tpInfoLeftBlank: 5.4,
// ...
corrInfoLeftBlank: 4,
```

After deletion, `spacingRem` should look like (excerpt — surrounding keys remain):

```js
spacingRem: {
  headerActionGap: 0.35,
  panelFooterGap: 0.4,
  inlineValueGap: 0.4,
  metricsListGap: 0.45,
  axisGapX: 0.4,
  axisGapY: 0.4,
  peakAxisChartGap: 0.5,
  peakChannelGap: 0.4,
  peakDisplayTopInset: 0.5,
  peakDisplayBottomInset: 0.5,
  meterChartInsetX: 0.6,
  meterLabelLeftInset: 1.6,
  meterLabelTopInset: 0.5,
  chartOuterInset: 0,
  vectorCornerInset: 0.4,
  historyDisplayTopInset: 0.1,
  historyDisplayBottomInset: 0,
  historySvgPad: 0.4,
  hudInset: 0.25,
  spectrumDisplayTopInset: 0.5,
  spectrumDisplayBottomInset: 0,
  spectrumSvgPad: 0.4,
},
```

- [ ] **Step 2: Delete the two `setCssVar` calls from `applyDocumentTheme.js`**

In `src/preferences/applyDocumentTheme.js`, find and remove these two lines (around line 101-102):

```js
// DELETE these two lines:
setCssVar("--ui-tp-info-left-blank", `${spacingRem.tpInfoLeftBlank}rem`);
setCssVar("--ui-corr-info-left-blank", `${spacingRem.corrInfoLeftBlank}rem`);
```

- [ ] **Step 3: Run the test suite to confirm nothing broke**

```bash
npm test -- --run
```

Expected: all tests pass. The removed vars are not referenced in any test file.

- [ ] **Step 4: Commit**

```bash
git add src/preferences/data.js src/preferences/applyDocumentTheme.js
git commit -m "refactor(prefs): remove tpInfoLeftBlank and corrInfoLeftBlank CSS vars"
```

---

### Task 2: Update PeakPanel — calc spacer + container queries + remove compact

**Files:**
- Modify: `src/components/panels/PeakPanel.jsx`

- [ ] **Step 1: Remove `compact` from the function signature**

Line 52 currently reads:

```jsx
export function PeakPanel({ compact = false }) {
```

Change to:

```jsx
export function PeakPanel() {
```

- [ ] **Step 2: Add `@container` to the panel root div**

The root `<div>` at line 57 currently has:

```jsx
<div
  className={cn(
    PANEL_MIN_PEAK,
    "flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
  )}
>
```

Change to:

```jsx
<div
  className={cn(
    PANEL_MIN_PEAK,
    "@container flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
  )}
>
```

- [ ] **Step 3: Add `@max-[220px]:hidden` to the channel bar label div**

The label div at line 103 currently reads:

```jsx
<div className="absolute left-[var(--ui-meter-label-left-inset)] right-0 top-[var(--ui-meter-label-top-inset)] text-left text-[length:var(--ui-fs-display)] text-muted-foreground">
```

Change to:

```jsx
<div className="@max-[220px]:hidden absolute left-[var(--ui-meter-label-left-inset)] right-0 top-[var(--ui-meter-label-top-inset)] text-left text-[length:var(--ui-fs-display)] text-muted-foreground">
```

- [ ] **Step 4: Replace the magic-number spacer and add `@max-[220px]:hidden` to the TP MAX footer**

The footer row at line 113 currently reads:

```jsx
<div className="mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-start text-[length:var(--ui-fs-display)]">
  <div className="shrink-0" style={{ width: "var(--ui-tp-info-left-blank)" }} />
```

Change to:

```jsx
<div className="@max-[220px]:hidden mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-start text-[length:var(--ui-fs-display)]">
  <div
    className="shrink-0"
    style={{ width: "calc(var(--ui-w-peak-ticks) + var(--ui-peak-axis-chart-gap))" }}
  />
```

- [ ] **Step 5: Visually verify in the running app**

Start the dev server if not already running:

```bash
npm run dev
```

Open the app. Resize the Peak panel:
- Wide (>220px): channel labels, dB values, and "TP MAX" footer should all be visible. "TP MAX" should align under the chart column (not under the tick axis).
- Narrow (≤220px): channel labels and "TP MAX" footer should disappear. Meter fill and hold line should remain.

- [ ] **Step 6: Commit**

```bash
git add src/components/panels/PeakPanel.jsx
git commit -m "refactor(peak): container query compact hide + calc spacer alignment"
```

---

### Task 3: Update VectorscopePanel — remove spacer + container queries + remove compact

**Files:**
- Modify: `src/components/panels/VectorscopePanel.jsx`

- [ ] **Step 1: Remove `compact` from the function signature**

Line 6 currently reads:

```jsx
export function VectorscopePanel({ compact = false }) {
```

Change to:

```jsx
export function VectorscopePanel() {
```

- [ ] **Step 2: Add `@container` to the panel root div**

The root `<div>` at line 26 currently has:

```jsx
<div
  className={cn(
    PANEL_MIN_SPECTRUM,
    "flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
  )}
>
```

Change to:

```jsx
<div
  className={cn(
    PANEL_MIN_SPECTRUM,
    "@container flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
  )}
>
```

- [ ] **Step 3: Remove the spacer and add `@max-[220px]:hidden` to the CORRELATION footer**

The footer at line 120 currently reads:

```jsx
<div className="mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-start text-[length:var(--ui-fs-display)]">
  <div className="shrink-0" style={{ width: "var(--ui-corr-info-left-blank)" }} />
  <div className="flex items-baseline gap-[var(--ui-metric-inline-gap)]">
    <span className="text-muted-foreground">CORRELATION</span>
    <span
      className={
        Number.isFinite(correlation)
          ? "font-[family-name:var(--ui-font-mono)] tabular-nums font-semibold text-[color:var(--ui-signal-tp-max)]"
          : "font-[family-name:var(--ui-font-mono)] tabular-nums font-semibold text-muted-foreground"
      }
    >
      {Number.isFinite(correlation) ? correlation.toFixed(2) : "-"}
    </span>
  </div>
</div>
```

Replace the entire footer block with:

```jsx
<div className="@max-[220px]:hidden mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-start text-[length:var(--ui-fs-display)]">
  <div className="flex items-baseline gap-[var(--ui-metric-inline-gap)]">
    <span className="text-muted-foreground">CORRELATION</span>
    <span
      className={
        Number.isFinite(correlation)
          ? "font-[family-name:var(--ui-font-mono)] tabular-nums font-semibold text-[color:var(--ui-signal-tp-max)]"
          : "font-[family-name:var(--ui-font-mono)] tabular-nums font-semibold text-muted-foreground"
      }
    >
      {Number.isFinite(correlation) ? correlation.toFixed(2) : "-"}
    </span>
  </div>
</div>
```

- [ ] **Step 4: Visually verify in the running app**

Resize the Vectorscope panel:
- Wide (>220px): "CORRELATION" footer visible, flush-left with no spacer gap. Corner labels (channel pair names) visible.
- Narrow (≤220px): "CORRELATION" footer disappears. Vectorscope plot and corner labels remain.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/VectorscopePanel.jsx
git commit -m "refactor(vectorscope): container query compact hide + remove footer spacer"
```

---

### Task 4: Clean up `compact` prop callsite and registry type

**Files:**
- Modify: `src/workspace/LeafView.jsx`
- Modify: `src/workspace/registry.jsx`

- [ ] **Step 1: Remove `compact={false}` from `LeafView`**

In `src/workspace/LeafView.jsx` at line 186:

```jsx
{ActiveComponent && <ActiveComponent compact={false} />}
```

Change to:

```jsx
{ActiveComponent && <ActiveComponent />}
```

- [ ] **Step 2: Update the `MODULE_REGISTRY` type annotation in `registry.jsx`**

Line 9 currently reads:

```jsx
/** @type {Record<import('./types.js').ModuleId, { id: string, title: string, minWidth: number, minHeight: number, Component: React.FC<{compact:boolean}>, Icon: React.FC }>} */
```

Change to:

```jsx
/** @type {Record<import('./types.js').ModuleId, { id: string, title: string, minWidth: number, minHeight: number, Component: React.FC<{compact?: boolean}>, Icon: React.FC }>} */
```

(`compact` is now optional — `LoudnessPanel`, `SpectrumPanel`, `SpectrogramPanel` still have the default param in their signatures; marking it optional here keeps the type accurate without touching those files.)

- [ ] **Step 3: Run the full test suite**

```bash
npm test -- --run
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/workspace/LeafView.jsx src/workspace/registry.jsx
git commit -m "refactor(workspace): remove compact={false} prop and update registry type"
```
