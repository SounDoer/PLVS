# Stats Panel Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the loudness-only "Loudness Stats" panel into a general **Stats** panel by abstracting metric assembly into one catalog module and adding two cross-domain readouts (True Peak, Correlation, default hidden).

**Architecture:** A new pure module `src/lib/statsCatalog.js` becomes the single source of truth for stat metadata, default order, and the `buildStatsMetrics(displayAudio)` assembler. `panelControls.js` re-exports the catalog's metadata/order/options (persistence key names unchanged). `useLoudnessHistory` stops emitting `primaryMetrics`/`secondaryMetrics` and emits one merged `statsMetrics`; `App.jsx` forwards it; `LoudnessStatsPanel` consumes it. The registry title becomes `Stats`. Module id, file names, and persistence keys stay `loudnessStats`.

**Tech Stack:** React 19, Vitest + Testing Library, Vite, JS (JSDoc types).

**Spec:** `docs/superpowers/specs/2026-06-21-stats-panel-abstraction-design.md`

---

## File Structure

- **Create** `src/lib/statsCatalog.js` — `STATS_META`, `STATS_CANONICAL_ORDER`, `STATS_OPTIONS`, `dialogueOffsetText`, `buildStatsMetrics(displayAudio)`. Single source of truth for stat readouts.
- **Create** `src/lib/statsCatalog.test.js` — unit tests for the catalog + assembler.
- **Modify** `src/lib/panelControls.js` — re-export META/ORDER/OPTIONS from the catalog; keep persistence keys + defaults.
- **Modify** `src/lib/panelControls.test.js` — extend the id/order assertions for the two new ids.
- **Modify** `src/hooks/useLoudnessHistory.js` — drop local `dialogueOffsetText` + the two metric memos; emit `statsMetrics`.
- **Modify** `src/hooks/useLoudnessHistory.dialogue.test.js` — import `dialogueOffsetText` from the catalog.
- **Modify** `src/App.jsx` — destructure + forward `statsMetrics` into `AudioDataContext`.
- **Modify** `src/components/panels/LoudnessStatsPanel.jsx` — read `statsMetrics`.
- **Modify** `src/components/panels/LoudnessStatsPanel.test.jsx` — fixtures use `statsMetrics`.
- **Modify** `src/workspace/registry.jsx` — title `Loudness Stats` → `Stats`.
- **Modify** `src/components/PanelHeaderControls.test.jsx` — fixtures use `statsMetrics`; title assertions follow the rename.

---

## Task 1: Create the stats catalog module

**Files:**
- Create: `src/lib/statsCatalog.js`
- Create: `src/lib/statsCatalog.test.js`
- Modify: `src/hooks/useLoudnessHistory.js` (only: remove the local `dialogueOffsetText`, re-import it from the catalog — leaves `primaryMetrics`/`secondaryMetrics` intact this task)
- Modify: `src/hooks/useLoudnessHistory.dialogue.test.js` (import path)

- [ ] **Step 1: Write the failing catalog test**

Create `src/lib/statsCatalog.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  STATS_META,
  STATS_CANONICAL_ORDER,
  STATS_OPTIONS,
  dialogueOffsetText,
  buildStatsMetrics,
} from "./statsCatalog.js";

describe("statsCatalog", () => {
  it("lists the 12 loudness ids first, then the cross-domain readouts last", () => {
    expect(STATS_CANONICAL_ORDER).toEqual([
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
      "truePeak",
      "correlation",
    ]);
  });

  it("gives every catalog id a meta entry with a non-empty hint", () => {
    for (const id of STATS_CANONICAL_ORDER) {
      expect(STATS_META[id]).toBeTruthy();
      expect(typeof STATS_META[id].label).toBe("string");
      expect(STATS_META[id].label.length).toBeGreaterThan(0);
      expect(typeof STATS_META[id].hint).toBe("string");
      expect(STATS_META[id].hint.length).toBeGreaterThan(0);
    }
  });

  it("uses dBTP for True Peak and an empty unit for Correlation", () => {
    expect(STATS_META.truePeak.unit).toBe("dBTP");
    expect(STATS_META.correlation.unit).toBe("");
  });

  it("derives STATS_OPTIONS in canonical order with id/label/hint", () => {
    expect(STATS_OPTIONS.map((o) => o.id)).toEqual(STATS_CANONICAL_ORDER);
    const truePeak = STATS_OPTIONS.find((o) => o.id === "truePeak");
    expect(truePeak.label).toBe("True Peak");
    expect(truePeak.hint.length).toBeGreaterThan(0);
  });

  it("formats the dialogue offset as a signed LU value", () => {
    expect(dialogueOffsetText(-22, -20)).toBe("-2.0");
    expect(dialogueOffsetText(-18, -20)).toBe("+2.0");
    expect(dialogueOffsetText(-Infinity, -20)).toBe("-");
  });

  it("builds a single metrics array including True Peak and Correlation", () => {
    const metrics = buildStatsMetrics({
      momentary: -20,
      shortTerm: -18,
      integrated: -19,
      mMax: -10,
      stMax: -12,
      lra: 3,
      tpMax: -1,
      dialoguePercent: 62,
      dialogueIntegrated: -21,
      dialogueLra: 2,
      correlation: 0.85,
    });
    const byId = Object.fromEntries(metrics.map((m) => [m.id, m]));

    expect(metrics.map((m) => m.id)).toEqual(STATS_CANONICAL_ORDER);
    expect(byId.truePeak.value).toBe("-1.0");
    expect(byId.truePeak.unit).toBe("dBTP");
    expect(byId.correlation.value).toBe("0.85");
    expect(byId.correlation.unit).toBe("");
    // PSR = tpMax - shortTerm = -1 - (-18) = 17.0
    expect(byId.psr.value).toBe("17.0");
    expect(byId.dialogueCoverage.value).toBe("62");
  });

  it("shows a dash for Correlation when the value is not finite", () => {
    const metrics = buildStatsMetrics({ correlation: -Infinity });
    const correlation = metrics.find((m) => m.id === "correlation");
    expect(correlation.value).toBe("-");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/statsCatalog.test.js`
Expected: FAIL — cannot resolve `./statsCatalog.js`.

- [ ] **Step 3: Create the catalog module**

Create `src/lib/statsCatalog.js`:

```js
import { fmtMetric } from "../math/formatMath";

export const STATS_META = {
  momentary: { label: "Momentary", unit: "LUFS", hint: "Loudness over a 400ms window" },
  shortTerm: { label: "Short-term", unit: "LUFS", hint: "Loudness over a 3s window" },
  integrated: {
    label: "Integrated",
    unit: "LUFS",
    hint: "Loudness over the whole program, gated below −70 LUFS",
  },
  momentaryMax: {
    label: "Momentary Max",
    unit: "LUFS",
    hint: "Highest Momentary (400ms) loudness reached so far",
  },
  shortTermMax: {
    label: "Short-term Max",
    unit: "LUFS",
    hint: "Highest Short-term (3s) loudness reached so far",
  },
  lra: { label: "Loudness Range", unit: "LU", hint: "LRA, loudness range over the whole program" },
  psr: { label: "Short-term Dynamics", unit: "dB", hint: "PSR, Peak to Short-term loudness Ratio" },
  plr: { label: "Integrated Dynamics", unit: "dB", hint: "PLR, Peak to Loudness Ratio" },
  dialogueCoverage: {
    label: "Dialogue Coverage",
    unit: "%",
    hint: "Share of time dialogue is detected",
  },
  dialogueIntegrated: {
    label: "Dialogue Integrated",
    unit: "LUFS",
    hint: "Loudness over dialogue only",
  },
  dialogueRange: { label: "Dialogue Range", unit: "LU", hint: "Loudness range over dialogue only" },
  dialogueOffset: {
    label: "Dialogue Offset",
    unit: "LU",
    hint: "Dialogue loudness relative to the overall mix",
  },
  truePeak: {
    label: "True Peak",
    unit: "dBTP",
    hint: "Highest inter-sample (true) peak level reached so far",
  },
  correlation: {
    label: "Correlation",
    unit: "",
    hint: "Phase correlation of the stereo pair (+1 in phase, −1 out of phase)",
  },
};

export const STATS_CANONICAL_ORDER = [
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
  "truePeak",
  "correlation",
];

export const STATS_OPTIONS = STATS_CANONICAL_ORDER.map((id) => ({
  id,
  label: STATS_META[id].label,
  hint: STATS_META[id].hint,
}));

export function dialogueOffsetText(dialogueIntegrated, integrated) {
  if (!Number.isFinite(dialogueIntegrated) || !Number.isFinite(integrated)) return "-";
  const d = dialogueIntegrated - integrated;
  return `${d >= 0 ? "+" : "-"}${Math.abs(d).toFixed(1)}`;
}

function fmtCorrelation(v) {
  return Number.isFinite(v) ? v.toFixed(2) : "-";
}

/**
 * Assemble the full ordered list of stat readouts from the live/display audio object.
 * @param {object} displayAudio
 * @returns {{ id: string, label: string, value: string, unit: string, hint: string }[]}
 */
export function buildStatsMetrics(displayAudio) {
  const psr =
    Number.isFinite(displayAudio.tpMax) && Number.isFinite(displayAudio.shortTerm)
      ? displayAudio.tpMax - displayAudio.shortTerm
      : -Infinity;
  const plr =
    Number.isFinite(displayAudio.tpMax) && Number.isFinite(displayAudio.integrated)
      ? displayAudio.tpMax - displayAudio.integrated
      : -Infinity;

  const value = {
    momentary: fmtMetric(displayAudio.momentary),
    shortTerm: fmtMetric(displayAudio.shortTerm),
    integrated: fmtMetric(displayAudio.integrated),
    momentaryMax: fmtMetric(displayAudio.mMax),
    shortTermMax: fmtMetric(displayAudio.stMax),
    lra: fmtMetric(displayAudio.lra),
    psr: fmtMetric(psr),
    plr: fmtMetric(plr),
    dialogueCoverage: Number.isFinite(displayAudio.dialoguePercent)
      ? `${displayAudio.dialoguePercent.toFixed(0)}`
      : "-",
    dialogueIntegrated: fmtMetric(displayAudio.dialogueIntegrated),
    dialogueRange: fmtMetric(displayAudio.dialogueLra),
    dialogueOffset: dialogueOffsetText(displayAudio.dialogueIntegrated, displayAudio.integrated),
    truePeak: fmtMetric(displayAudio.tpMax),
    correlation: fmtCorrelation(displayAudio.correlation),
  };

  return STATS_CANONICAL_ORDER.map((id) => ({
    id,
    ...STATS_META[id],
    value: value[id],
  }));
}
```

- [ ] **Step 4: Run the catalog test to verify it passes**

Run: `npx vitest run src/lib/statsCatalog.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Re-point `dialogueOffsetText` in the hook at the catalog**

In `src/hooks/useLoudnessHistory.js`, delete the local definition (currently lines 12-16):

```js
export function dialogueOffsetText(dialogueIntegrated, integrated) {
  if (!Number.isFinite(dialogueIntegrated) || !Number.isFinite(integrated)) return "-";
  const d = dialogueIntegrated - integrated;
  return `${d >= 0 ? "+" : "-"}${Math.abs(d).toFixed(1)}`;
}
```

Import it locally (the `secondaryMetrics` memo still calls it), and re-export so existing importers of `dialogueOffsetText` from this hook keep working this task. A bare `export { x } from "…"` does **not** create a usable local binding, so import first, then re-export:

```js
import { LOUDNESS_STATS_META } from "@/lib/panelControls.js";
import { dialogueOffsetText } from "@/lib/statsCatalog.js";
export { dialogueOffsetText };
```

(The `primaryMetrics`/`secondaryMetrics` memos still reference the now-imported `dialogueOffsetText`, so they keep working.)

- [ ] **Step 6: Point the dialogue test at the catalog**

In `src/hooks/useLoudnessHistory.dialogue.test.js`, change line 2:

```js
import { dialogueOffsetText } from "../lib/statsCatalog.js";
```

- [ ] **Step 7: Run the touched tests**

Run: `npx vitest run src/lib/statsCatalog.test.js src/hooks/useLoudnessHistory.dialogue.test.js`
Expected: PASS for both.

- [ ] **Step 8: Commit**

```bash
git add src/lib/statsCatalog.js src/lib/statsCatalog.test.js src/hooks/useLoudnessHistory.js src/hooks/useLoudnessHistory.dialogue.test.js
git commit -m "feat(stats): add statsCatalog with True Peak + Correlation readouts"
```

---

## Task 2: Re-point panelControls at the catalog

**Files:**
- Modify: `src/lib/panelControls.js:1-59` (replace the local META/ORDER/OPTIONS with catalog re-exports)
- Modify: `src/lib/panelControls.test.js` (extend the id/order assertions)

- [ ] **Step 1: Update the panelControls assertions to expect the two new ids**

In `src/lib/panelControls.test.js`:

In the test `"defines stable stats and layer option ids"` (the `LOUDNESS_STATS_OPTIONS.map((o) => o.id)` assertion, lines 30-43), append the two ids so the array ends:

```js
      "dialogueCoverage",
      "dialogueIntegrated",
      "dialogueRange",
      "dialogueOffset",
      "truePeak",
      "correlation",
    ]);
```

In `"uses the agreed defaults"` (lines 83-96) and `"defaults loudnessStatsOrder to the full LOUDNESS_STATS_ORDER"` (lines 102-115), append `"truePeak", "correlation"` to the END of each `loudnessStatsOrder` array (after `"dialogueOffset"`). Do **not** add them to `loudnessStatsVisibleIds` — that array stays the existing 8 ids.

In `"normalizes loudnessStatsOrder: dedupe, drop unknown, backfill missing in default order"` (lines 122-135), append `"truePeak", "correlation"` to the END of the expected array (after `"dialogueOffset"`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/panelControls.test.js`
Expected: FAIL — current `LOUDNESS_STATS_ORDER` has only 12 ids.

- [ ] **Step 3: Re-point panelControls at the catalog**

In `src/lib/panelControls.js`, replace the top block (lines 1-59: the `LOUDNESS_STATS_META`, `LOUDNESS_STATS_ORDER`, and `LOUDNESS_STATS_OPTIONS` definitions) with re-exports from the catalog:

```js
import {
  STATS_META,
  STATS_CANONICAL_ORDER,
  STATS_OPTIONS,
} from "./statsCatalog.js";

export const LOUDNESS_STATS_META = STATS_META;
export const LOUDNESS_STATS_ORDER = STATS_CANONICAL_ORDER;
export const LOUDNESS_STATS_OPTIONS = STATS_OPTIONS;
```

Leave the rest of the file unchanged — `LOUDNESS_HISTORY_LAYER_OPTIONS`, `LEVEL_METER_MODE_OPTIONS`, `DEFAULT_PANEL_CONTROLS` (its `loudnessStatsVisibleIds` stays the 8 ids; `loudnessStatsOrder: [...LOUDNESS_STATS_ORDER]` now resolves to 14), and all `normalize*` helpers stay as-is. `normalizeOrder` already backfills missing canonical ids at the tail (`src/lib/panelControls.js:145-161`), so persisted 12-id orders auto-gain the two new ids.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/panelControls.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/panelControls.js src/lib/panelControls.test.js
git commit -m "feat(stats): source panel-control stat options from statsCatalog"
```

---

## Task 3: Merge to a single `statsMetrics` data flow

This task changes the hook output, the context, the panel, and their fixtures together so the app stays green.

**Files:**
- Modify: `src/hooks/useLoudnessHistory.js` (replace `primaryMetrics`/`secondaryMetrics` with `statsMetrics`)
- Modify: `src/App.jsx:419-420`, `:986-987` (destructure + forward `statsMetrics`)
- Modify: `src/components/panels/LoudnessStatsPanel.jsx:52,56` (read `statsMetrics`)
- Modify: `src/components/panels/LoudnessStatsPanel.test.jsx` (fixtures)
- Modify: `src/components/PanelHeaderControls.test.jsx` (fixtures: `primaryMetrics`/`secondaryMetrics` → `statsMetrics`)

- [ ] **Step 1: Update the LoudnessStatsPanel test fixtures to `statsMetrics`**

In `src/components/panels/LoudnessStatsPanel.test.jsx`:

Replace the two fixture arrays (lines 7-53) with one:

```js
const statsMetrics = [
  {
    id: "momentary",
    label: "Momentary",
    value: "-20.0",
    unit: "LUFS",
    hint: "Loudness over a 400ms window",
  },
  {
    id: "shortTerm",
    label: "Short-term",
    value: "-18.0",
    unit: "LUFS",
    hint: "Loudness over a 3s window",
  },
  {
    id: "integrated",
    label: "Integrated",
    value: "-19.0",
    unit: "LUFS",
    hint: "Loudness over the whole program, gated below −70 LUFS",
  },
  {
    id: "lra",
    label: "Loudness Range",
    value: "3.0",
    unit: "LU",
    hint: "LRA, loudness range over the whole program",
  },
  {
    id: "psr",
    label: "Short-term Dynamics",
    value: "7.0",
    unit: "dB",
    hint: "PSR, Peak to Short-term loudness Ratio",
  },
  {
    id: "plr",
    label: "Integrated Dynamics",
    value: "8.0",
    unit: "dB",
    hint: "PLR, Peak to Loudness Ratio",
  },
];
```

In `renderPanel` (was lines 55-67), pass `statsMetrics` instead of the two arrays:

```js
function renderPanel(visibleIds) {
  return render(
    <AudioDataContext.Provider
      value={{
        statsMetrics,
        panelControls: { loudnessStatsVisibleIds: visibleIds },
      }}
    >
      <LoudnessStatsPanel />
    </AudioDataContext.Provider>
  );
}
```

In the `"shows an active speaking-now dot…"` test (was lines 108-122), replace the two arrays with:

```js
          statsMetrics: [
            { id: "dialogueCoverage", label: "Dialogue Coverage", value: "62", unit: "%" },
          ],
```

In the `"renders visible metrics in loudnessStatsOrder…"` test (was lines 128-141), replace the two-array provider value with:

```js
        value={{
          statsMetrics,
          panelControls: {
            loudnessStatsVisibleIds: ["momentary", "integrated", "psr"],
            loudnessStatsOrder: ["psr", "lra", "integrated", "momentary", "shortTerm"],
          },
        }}
```

- [ ] **Step 2: Run the panel test to verify it fails**

Run: `npx vitest run src/components/panels/LoudnessStatsPanel.test.jsx`
Expected: FAIL — panel still reads `primaryMetrics`/`secondaryMetrics`, which are now `undefined`.

- [ ] **Step 3: Make the panel read `statsMetrics`**

In `src/components/panels/LoudnessStatsPanel.jsx`, change the context destructure (line 52) and drop the concat (line 56):

```js
  const { statsMetrics, panelControls, dialogueActiveNow } = useAudioData();
  const loudnessStatsVisibleIds = panelControls?.loudnessStatsVisibleIds;
  const loudnessStatsOrder = panelControls?.loudnessStatsOrder;
  const visibleIds = Array.isArray(loudnessStatsVisibleIds) ? loudnessStatsVisibleIds : [];
  const allMetrics = Array.isArray(statsMetrics) ? statsMetrics : [];
```

Leave the rest of the component (the `metricById` map, ordering, `visibleMetrics`, render) unchanged.

- [ ] **Step 4: Run the panel test to verify it passes**

Run: `npx vitest run src/components/panels/LoudnessStatsPanel.test.jsx`
Expected: PASS.

- [ ] **Step 5: Replace the hook's two memos with one `statsMetrics`**

In `src/hooks/useLoudnessHistory.js`:

Add the catalog import near the top imports (the `export { dialogueOffsetText } …` re-export line from Task 1 can stay or be merged):

```js
import { buildStatsMetrics } from "@/lib/statsCatalog.js";
```

Delete the `psr`/`plr` consts (currently `:118-125`), the `primaryMetrics` memo (`:127-157`), and the `secondaryMetrics` memo (`:159-187`). Replace all of that with a single memo:

```js
  const statsMetrics = useMemo(() => buildStatsMetrics(displayAudio), [displayAudio]);
```

In the returned object (currently `:218-219`), replace:

```js
    primaryMetrics,
    secondaryMetrics,
```

with:

```js
    statsMetrics,
```

> Note: `LOUDNESS_STATS_META` may now be unused in this file. If so, remove its import (line 10). Keep the `export { dialogueOffsetText } from "@/lib/statsCatalog.js";` re-export — the dialogue test imports from the catalog now, but other code may still import it from the hook; verify with `git grep "dialogueOffsetText"` and drop the re-export only if nothing else imports it from here.

- [ ] **Step 6: Forward `statsMetrics` through App context**

In `src/App.jsx`, in the `useLoudnessHistory(...)` destructure (lines 419-420), replace:

```js
    primaryMetrics,
    secondaryMetrics,
```

with:

```js
    statsMetrics,
```

In the `audioData` context object (lines 986-987), replace:

```js
    primaryMetrics,
    secondaryMetrics,
```

with:

```js
    statsMetrics,
```

- [ ] **Step 7: Update PanelHeaderControls fixtures to `statsMetrics`**

In `src/components/PanelHeaderControls.test.jsx`, in each `AudioDataContext.Provider` value that sets `primaryMetrics: []` and `secondaryMetrics: []` (three places: ~lines 399-400, 440-441, 467-468), replace the two lines with:

```js
              statsMetrics: [],
```

- [ ] **Step 8: Run the affected suites**

Run: `npx vitest run src/hooks src/components/panels/LoudnessStatsPanel.test.jsx src/components/PanelHeaderControls.test.jsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useLoudnessHistory.js src/App.jsx src/components/panels/LoudnessStatsPanel.jsx src/components/panels/LoudnessStatsPanel.test.jsx src/components/PanelHeaderControls.test.jsx
git commit -m "feat(stats): merge loudness metrics into a single statsMetrics flow"
```

---

## Task 4: Rename the panel surface to "Stats"

**Files:**
- Modify: `src/workspace/registry.jsx:42`
- Modify: `src/components/PanelHeaderControls.test.jsx:480-481`

- [ ] **Step 1: Update the title assertion**

In `src/components/PanelHeaderControls.test.jsx`, the test `"does not render a remove button beside the panel tab title"` (lines 480-481). After the rename, the header shows the title `Stats` **and** the stats chip button is also labeled `Stats`, so `getByText("Stats")` would match more than one node. Replace lines 480-481 with:

```js
    expect(screen.getAllByText("Stats").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Remove Stats")).toBeNull();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/PanelHeaderControls.test.jsx`
Expected: FAIL — registry title is still `Loudness Stats`, so `getAllByText("Stats")` finds only the chip button while `getByText("Loudness Stats")` (old line) is gone... actually this asserts the new behavior; it fails because the title node still reads `Loudness Stats`. (If it unexpectedly passes because the chip alone satisfies `length > 0`, Step 3 still applies and the rename is required by the spec.)

- [ ] **Step 3: Rename the registry title**

In `src/workspace/registry.jsx`, line 42, change:

```js
    title: "Loudness Stats",
```

to:

```js
    title: "Stats",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/PanelHeaderControls.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workspace/registry.jsx src/components/PanelHeaderControls.test.jsx
git commit -m "feat(stats): rename panel surface from Loudness Stats to Stats"
```

---

## Task 5: Full verification

- [ ] **Step 1: Confirm no stale references remain**

Run: `git grep -nE "primaryMetrics|secondaryMetrics" -- src/`
Expected: no matches in `src/` (docs/plans may still mention them — ignore).

- [ ] **Step 2: Run the full project check**

Run: `npm run check`
Expected: PASS — front-end format + lint + test + build + version, plus Rust fmt/clippy/test. (No Rust files were touched; the Rust steps should be unaffected.)

- [ ] **Step 3: Commit any formatter-only changes**

If `npm run check` reformatted anything:

```bash
git add -A
git commit -m "chore(stats): apply formatter after stats panel abstraction"
```

---

## Notes for the implementer

- **No new DSP.** True Peak reads `displayAudio.tpMax`; Correlation reads `displayAudio.correlation`. Both already exist on the `displayAudio` state object (`src/App.jsx:280-303`).
- **Default-hidden is intentional.** `DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds` must keep exactly the 8 existing loudness ids. Reset must not surface True Peak or Correlation.
- **Persistence keys do not change.** `loudnessStatsVisibleIds` / `loudnessStatsOrder` keep their names; no storage migration.
- **Module id stays `loudnessStats`.** Only the user-facing registry title changes.
