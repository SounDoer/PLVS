# Loudness Stats Labels + Hover Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every loudness-stats metric one canonical plain-language label (shared by panel and picker) plus a hover tip explaining it, sourced from a single registry.

**Architecture:** Introduce a `LOUDNESS_STATS_META` registry (`id → {label, unit, hint}`) in `panelControls.js` as the single source of truth. The picker options and the panel hook both read from it, so labels can never drift. Hints render through a small reusable `HoverTip` component extracted from the existing custom CSS tooltip in `IconButton` (no new dependency).

**Tech Stack:** React (JSX), Vite, Vitest + Testing Library, Tailwind, `cn()` (clsx + tailwind-merge).

---

## File Structure

- `src/lib/panelControls.js` — **modify.** Replace `LOUDNESS_STATS_OPTIONS` array with a `LOUDNESS_STATS_META` registry + canonical `LOUDNESS_STATS_ORDER`; derive `LOUDNESS_STATS_OPTIONS` (now `{id, label, hint}`) from them. Single source of truth.
- `src/lib/panelControls.test.js` — **modify.** Add coverage for new labels + hint presence.
- `src/components/HoverTip.jsx` — **create.** Reusable hover-reveal text tip (custom CSS, themed via tokens), extracted from `IconButton`.
- `src/components/HoverTip.test.jsx` — **create.** Verifies tip text + children render.
- `src/components/IconButton.jsx` — **modify.** Render its tooltip through `HoverTip` (behavior unchanged) so there is one implementation.
- `src/hooks/useLoudnessHistory.js` — **modify.** Each metric object spreads `...LOUDNESS_STATS_META[id]` for label/unit/hint and supplies only the live `value`.
- `src/components/panels/LoudnessStatsPanel.jsx` — **modify.** `MetricRow` wraps the row in `HoverTip` using the metric's `hint`.
- `src/components/panels/LoudnessStatsPanel.test.jsx` — **modify.** Update the three renamed labels; assert hint text renders.
- `src/components/PanelHeaderControls.jsx` — **modify.** Each picker option button wraps in `HoverTip` using `option.hint`.
- `src/components/PanelHeaderControls.test.jsx` — **modify.** Assert a picker option exposes its hint.

**Note on the `−` character:** hint strings use a Unicode minus `−` (U+2212) in `−70 LUFS`, matching existing DSP comments. Copy it verbatim.

**Task order / dependencies:** Task 1 (registry) → Task 2 (HoverTip + IconButton) → Task 3 (hook reads registry) → Task 4 (panel rows) → Task 5 (picker) → Task 6 (full verification). Tasks 2 and 1 are independent; 3 needs 1; 4 needs 1+2+3; 5 needs 1+2.

---

### Task 1: Registry as single source of truth

**Files:**
- Modify: `src/lib/panelControls.js:4-17` (replace the `LOUDNESS_STATS_OPTIONS` array)
- Test: `src/lib/panelControls.test.js`

- [ ] **Step 1: Update the failing tests first**

In `src/lib/panelControls.test.js`, add these two tests inside the `describe("panelControls", …)` block (after the existing `"defines stable stats and layer option ids"` test):

```js
it("uses plain-language labels for the derived metrics", () => {
  const byId = Object.fromEntries(LOUDNESS_STATS_OPTIONS.map((o) => [o.id, o.label]));
  expect(byId.lra).toBe("Loudness Range");
  expect(byId.psr).toBe("Short-term Dynamics");
  expect(byId.plr).toBe("Integrated Dynamics");
  expect(byId.dialogueRange).toBe("Dialogue Range");
});

it("gives every stats option a non-empty hint", () => {
  for (const opt of LOUDNESS_STATS_OPTIONS) {
    expect(typeof opt.hint).toBe("string");
    expect(opt.hint.length).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/panelControls.test.js`
Expected: FAIL — `byId.lra` is `undefined`/old value and `opt.hint` is `undefined` (registry not added yet).

- [ ] **Step 3: Replace the options array with the registry**

In `src/lib/panelControls.js`, replace the whole `LOUDNESS_STATS_OPTIONS` block (lines 4–17) with:

```js
export const LOUDNESS_STATS_META = {
  momentary:    { label: "Momentary",           unit: "LUFS", hint: "Loudness over a 400ms window" },
  shortTerm:    { label: "Short-term",          unit: "LUFS", hint: "Loudness over a 3s window" },
  integrated:   { label: "Integrated",          unit: "LUFS", hint: "Loudness over the whole program, gated below −70 LUFS" },
  momentaryMax: { label: "Momentary Max",       unit: "LUFS", hint: "Highest Momentary (400ms) loudness reached so far" },
  shortTermMax: { label: "Short-term Max",      unit: "LUFS", hint: "Highest Short-term (3s) loudness reached so far" },
  lra:          { label: "Loudness Range",      unit: "LU",   hint: "LRA, loudness range over the whole program" },
  psr:          { label: "Short-term Dynamics", unit: "dB",   hint: "PSR, Peak to Short-term loudness Ratio" },
  plr:          { label: "Integrated Dynamics", unit: "dB",   hint: "PLR, Peak to Loudness Ratio" },
  dialogueCoverage:   { label: "Dialogue Coverage",   unit: "%",    hint: "Share of time dialogue is detected" },
  dialogueIntegrated: { label: "Dialogue Integrated", unit: "LUFS", hint: "Loudness over dialogue only" },
  dialogueRange:      { label: "Dialogue Range",      unit: "LU",   hint: "Loudness range over dialogue only" },
  dialogueOffset:     { label: "Dialogue Offset",     unit: "LU",   hint: "Dialogue loudness relative to the overall mix" },
};

export const LOUDNESS_STATS_ORDER = [
  "momentary",
  "shortTerm",
  "integrated",
  "momentaryMax",
  "shortTermMax",
  "lra",
  "psr",
  "plr",
  "dialogueCoverage",
  "dialogueIntegrated",
  "dialogueRange",
  "dialogueOffset",
];

export const LOUDNESS_STATS_OPTIONS = LOUDNESS_STATS_ORDER.map((id) => ({
  id,
  label: LOUDNESS_STATS_META[id].label,
  hint: LOUDNESS_STATS_META[id].hint,
}));
```

Leave everything else in the file unchanged. `LOUDNESS_STATS_IDS` (further down) is `new Set(LOUDNESS_STATS_OPTIONS.map((option) => option.id))` and keeps working. `DEFAULT_PANEL_CONTROLS` keeps its explicit id list.

- [ ] **Step 4: Run the full panelControls test file**

Run: `npx vitest run src/lib/panelControls.test.js`
Expected: PASS (the new tests plus the existing order/defaults/normalization tests — order is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/lib/panelControls.js src/lib/panelControls.test.js
git commit -m "feat(loudness): registry of stats label/unit/hint as single source"
```

---

### Task 2: Reusable HoverTip component + IconButton refactor

**Files:**
- Create: `src/components/HoverTip.jsx`
- Create: `src/components/HoverTip.test.jsx`
- Modify: `src/components/IconButton.jsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/HoverTip.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoverTip } from "./HoverTip.jsx";

describe("HoverTip", () => {
  it("renders children and the tip text", () => {
    render(
      <HoverTip tip="Explain me">
        <button type="button">Child</button>
      </HoverTip>
    );
    expect(screen.getByRole("button", { name: "Child" })).toBeTruthy();
    expect(screen.getByText("Explain me")).toBeTruthy();
  });

  it("renders children only when no tip is given", () => {
    render(
      <HoverTip>
        <span>Just me</span>
      </HoverTip>
    );
    expect(screen.getByText("Just me")).toBeTruthy();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/HoverTip.test.jsx`
Expected: FAIL — cannot resolve `./HoverTip.jsx`.

- [ ] **Step 3: Create the HoverTip component**

Create `src/components/HoverTip.jsx`:

```jsx
import { cn } from "@/lib/utils";

const SIDE_CLASSES = {
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
  right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
};

/**
 * Wraps children with a hover-reveal text tip (custom CSS, themed via tokens).
 * The tip is an absolutely-positioned sibling of the children, so it does NOT
 * affect the children's accessible name. It is not portaled, so an ancestor with
 * `overflow` will clip it — choose `side`/`tipClassName` accordingly.
 *
 * @param {{
 *   tip?: string,
 *   side?: "bottom" | "right",
 *   children: import("react").ReactNode,
 *   className?: string,
 *   tipClassName?: string,
 * }} props
 */
export function HoverTip({ tip, side = "bottom", children, className, tipClassName }) {
  return (
    <div className={cn("relative group", className)}>
      {children}
      {tip && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50",
            SIDE_CLASSES[side],
            "opacity-0 pointer-events-none group-hover:opacity-100",
            "transition-opacity duration-100 delay-100",
            "text-[11px] text-foreground bg-popover",
            "border border-white/10 rounded px-2 py-1",
            "whitespace-nowrap shadow-md",
            tipClassName
          )}
        >
          {tip}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/HoverTip.test.jsx`
Expected: PASS.

- [ ] **Step 5: Refactor IconButton to use HoverTip**

Replace the entire body of `src/components/IconButton.jsx` with:

```jsx
import { cn } from "@/lib/utils";
import { HoverTip } from "@/components/HoverTip";

/**
 * A small icon-only button with an optional tooltip.
 *
 * @param {{
 *   icon: import("react").ReactNode,
 *   tip?: string,
 *   disabled?: boolean,
 *   onClick?: () => void,
 *   className?: string,
 * }} props
 */
export function IconButton({ icon, tip, disabled = false, onClick, className }) {
  return (
    <HoverTip tip={tip} side="bottom">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "flex items-center justify-center size-8 rounded-md",
          "text-muted-foreground bg-transparent",
          "transition-colors duration-[120ms]",
          disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-secondary hover:text-foreground",
          className
        )}
      >
        {icon}
      </button>
    </HoverTip>
  );
}
```

- [ ] **Step 6: Run the toolbar/source tests that exercise IconButton**

Run: `npx vitest run src/App.toolbar.test.js src/components/HoverTip.test.jsx`
Expected: PASS (the toolbar source assertions don't depend on the tooltip markup; HoverTip tests pass).

- [ ] **Step 7: Commit**

```bash
git add src/components/HoverTip.jsx src/components/HoverTip.test.jsx src/components/IconButton.jsx
git commit -m "refactor(ui): extract HoverTip, route IconButton tooltip through it"
```

---

### Task 3: Hook reads label/unit/hint from the registry

**Files:**
- Modify: `src/hooks/useLoudnessHistory.js:130-199` (the `primaryMetrics` and `secondaryMetrics` memos)

- [ ] **Step 1: Add the registry import**

At the top of `src/hooks/useLoudnessHistory.js`, add this import alongside the existing imports:

```js
import { LOUDNESS_STATS_META } from "@/lib/panelControls.js";
```

- [ ] **Step 2: Replace the primaryMetrics memo**

Replace the `primaryMetrics` memo (currently lines 130–165) with:

```js
  const primaryMetrics = useMemo(
    () => [
      { id: "momentary", ...LOUDNESS_STATS_META.momentary, value: fmtMetric(displayAudio.momentary) },
      { id: "shortTerm", ...LOUDNESS_STATS_META.shortTerm, value: fmtMetric(displayAudio.shortTerm) },
      { id: "integrated", ...LOUDNESS_STATS_META.integrated, value: fmtMetric(displayAudio.integrated) },
      { id: "momentaryMax", ...LOUDNESS_STATS_META.momentaryMax, value: fmtMetric(displayAudio.mMax) },
      { id: "shortTermMax", ...LOUDNESS_STATS_META.shortTermMax, value: fmtMetric(displayAudio.stMax) },
      { id: "lra", ...LOUDNESS_STATS_META.lra, value: fmtMetric(displayAudio.lra) },
    ],
    [displayAudio]
  );
```

- [ ] **Step 3: Replace the secondaryMetrics memo**

Replace the `secondaryMetrics` memo (currently lines 167–199) with:

```js
  const secondaryMetrics = useMemo(
    () => [
      { id: "psr", ...LOUDNESS_STATS_META.psr, value: fmtMetric(psr) },
      { id: "plr", ...LOUDNESS_STATS_META.plr, value: fmtMetric(plr) },
      {
        id: "dialogueCoverage",
        ...LOUDNESS_STATS_META.dialogueCoverage,
        value: Number.isFinite(displayAudio.dialoguePercent)
          ? `${displayAudio.dialoguePercent.toFixed(0)}`
          : "—",
      },
      {
        id: "dialogueIntegrated",
        ...LOUDNESS_STATS_META.dialogueIntegrated,
        value: fmtMetric(displayAudio.dialogueIntegrated),
      },
      {
        id: "dialogueRange",
        ...LOUDNESS_STATS_META.dialogueRange,
        value: fmtMetric(displayAudio.dialogueLra),
      },
      {
        id: "dialogueOffset",
        ...LOUDNESS_STATS_META.dialogueOffset,
        value: dialogueOffsetText(displayAudio.dialogueIntegrated, displayAudio.integrated),
      },
    ],
    [psr, plr, displayAudio]
  );
```

- [ ] **Step 4: Run the hook's tests**

Run: `npx vitest run src/hooks/useLoudnessHistory.dialogue.test.js`
Expected: PASS (these tests assert dialogue values/visibility, not labels).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useLoudnessHistory.js
git commit -m "feat(loudness): source stats label/unit/hint from registry in hook"
```

---

### Task 4: Panel rows show the hint

**Files:**
- Modify: `src/components/panels/LoudnessStatsPanel.jsx` (`MetricRow`)
- Modify: `src/components/panels/LoudnessStatsPanel.test.jsx`

- [ ] **Step 1: Update the test fixtures + assertions**

In `src/components/panels/LoudnessStatsPanel.test.jsx`, replace the `primaryMetrics` and `secondaryMetrics` fixtures (lines 7–17) with:

```js
const primaryMetrics = [
  { id: "momentary", label: "Momentary", value: "-20.0", unit: "LUFS", hint: "Loudness over a 400ms window" },
  { id: "shortTerm", label: "Short-term", value: "-18.0", unit: "LUFS", hint: "Loudness over a 3s window" },
  { id: "integrated", label: "Integrated", value: "-19.0", unit: "LUFS", hint: "Loudness over the whole program, gated below −70 LUFS" },
  { id: "lra", label: "Loudness Range", value: "3.0", unit: "LU", hint: "LRA, loudness range over the whole program" },
];

const secondaryMetrics = [
  { id: "psr", label: "Short-term Dynamics", value: "7.0", unit: "dB", hint: "PSR, Peak to Short-term loudness Ratio" },
  { id: "plr", label: "Integrated Dynamics", value: "8.0", unit: "dB", hint: "PLR, Peak to Loudness Ratio" },
];
```

Then change the `"renders only visible stats"` test body (lines 34–41) to:

```js
  it("renders only visible stats", () => {
    renderPanel(["integrated", "psr"]);

    expect(screen.getByText("Integrated")).toBeTruthy();
    expect(screen.getByText("Short-term Dynamics")).toBeTruthy();
    expect(screen.queryByText("Momentary")).toBeNull();
    expect(screen.queryByText("Short-term")).toBeNull();
  });
```

And add this test right after it:

```js
  it("exposes the hover hint for a visible metric", () => {
    renderPanel(["integrated"]);

    expect(
      screen.getByText("Loudness over the whole program, gated below −70 LUFS")
    ).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/panels/LoudnessStatsPanel.test.jsx`
Expected: FAIL — the hint text is not in the DOM yet (`MetricRow` doesn't render it).

- [ ] **Step 3: Wrap the row in HoverTip**

In `src/components/panels/LoudnessStatsPanel.jsx`:

Add the import near the top (after the existing imports):

```js
import { HoverTip } from "@/components/HoverTip";
```

Change the `MetricRow` signature to destructure `hint`:

```js
function MetricRow({ id, label, value, unit, active, hint }) {
```

Replace the final `return` of `MetricRow` (currently `return <div className={METRIC_ROW_LAYOUT}>{content}</div>;`) with:

```js
  return (
    <HoverTip tip={hint} tipClassName="whitespace-normal w-max max-w-[15rem]">
      <div className={METRIC_ROW_LAYOUT}>{content}</div>
    </HoverTip>
  );
```

(The spread `{...metric}` in the panel already forwards `hint` into `MetricRow`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/panels/LoudnessStatsPanel.test.jsx`
Expected: PASS — including the unchanged `"does not render metric rows as buttons"` test (HoverTip renders a `div`, not a button) and the dialogue-dot test.

- [ ] **Step 5: Commit**

```bash
git add src/components/panels/LoudnessStatsPanel.jsx src/components/panels/LoudnessStatsPanel.test.jsx
git commit -m "feat(loudness): show hover hint on stats panel rows"
```

---

### Task 5: Picker options show the hint

**Files:**
- Modify: `src/components/PanelHeaderControls.jsx` (`MultiSelectChip`)
- Modify: `src/components/PanelHeaderControls.test.jsx`

- [ ] **Step 1: Add the failing test**

In `src/components/PanelHeaderControls.test.jsx`, add this test inside the `describe("PanelHeaderControls", …)` block (after the `"renders Stats chip and toggles stat ids"` test):

```js
  it("shows a hover hint for each stat option", () => {
    render(
      <PanelHeaderControls
        activeTab="loudnessStats"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Stats" }));

    expect(screen.getByText("Loudness over a 400ms window")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Momentary" })).toBeTruthy();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/PanelHeaderControls.test.jsx`
Expected: FAIL — the hint text is not rendered (options aren't wrapped in HoverTip yet).

- [ ] **Step 3: Wrap each option button in HoverTip**

In `src/components/PanelHeaderControls.jsx`:

Add the import (after the existing imports):

```js
import { HoverTip } from "@/components/HoverTip";
```

In `MultiSelectChip`, replace the `options.map(...)` block (the `return` inside it that renders each `<button role="checkbox">`) so the button is wrapped:

```jsx
          {options.map((option) => {
            const checked = selectedIds.includes(option.id);

            return (
              <HoverTip key={option.id} tip={option.hint} side="right">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  className="flex w-full items-center gap-2 whitespace-nowrap rounded-sm px-2 py-1.5 text-left text-sm text-popover-foreground outline-none hover:bg-accent hover:text-accent-foreground"
                  onClick={() => onToggle(option.id)}
                >
                  <span className="flex size-4 items-center justify-center">
                    {checked ? <Check aria-hidden="true" className="size-4" /> : null}
                  </span>
                  {option.label}
                </button>
              </HoverTip>
            );
          })}
```

(The `key` moves from the button to `HoverTip`. The tip is a sibling of the button, so `getByRole("checkbox", { name: "Momentary" })` is unaffected.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/PanelHeaderControls.test.jsx`
Expected: PASS — including the existing toggle tests (accessible names unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/PanelHeaderControls.jsx src/components/PanelHeaderControls.test.jsx
git commit -m "feat(loudness): show hover hint on stats picker options"
```

---

### Task 6: Full verification + manual clipping check

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: PASS, no failures.

- [ ] **Step 2: Lint/build sanity (if configured)**

Run: `npm run lint`
Expected: PASS (or no new errors in the files touched). If there is no `lint` script, skip.

- [ ] **Step 3: Manual app check — the overflow-clipping risk**

Launch the app (use the project's run skill / `npm run tauri dev` or `npm run dev`). Then:
- Open the Loudness Stats panel. Hover each row, especially **Integrated** (its hint is the longest: "Loudness over the whole program, gated below −70 LUFS"). Confirm the tip is fully visible and **not clipped** by the panel's scroll container (`overflow-y-auto`) and does not trigger a horizontal scrollbar.
- Open the **Stats** picker chip. Hover options near the top and bottom; confirm the `side="right"` tip is readable and not clipped by the popover edge or the window.
- Toggle plvs-dark and plvs-light; confirm the tip colors follow the theme.

If any tip is clipped in the panel or picker and cannot be fixed by adjusting `side` / `tipClassName` (e.g. switching the panel tip to `side="right"`, or reducing `max-w`), escalate those two surfaces to the shadcn/Radix `Tooltip` (which portals out of overflow containers) as noted in the spec, and re-verify.

- [ ] **Step 4: Final commit (only if Step 3 required adjustments)**

```bash
git add -A
git commit -m "fix(loudness): adjust hover hint placement to avoid clipping"
```

---

## Notes for the implementer

- **Single source of truth:** after Task 1, never hard-code a loudness-stats label or hint anywhere else — read `LOUDNESS_STATS_META` / `LOUDNESS_STATS_OPTIONS`.
- **Out of scope (separate CL):** the unused native-`title` code in `MeterHealthBadge.jsx` and `meteringFootnoteHints.js` is dead and is being cleaned up separately. Do not touch it here.
- **Why custom tooltip, not Radix:** keeps the app to one tooltip implementation and adds no dependency. The trade-off is overflow clipping (Task 6, Step 3), which is the only real risk.
