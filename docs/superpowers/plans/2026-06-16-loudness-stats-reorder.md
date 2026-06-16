# Loudness Stats Custom Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag-reorder the Loudness Stats metrics in the header "Stats" popover, with the order persisted independently of visibility.

**Architecture:** Add a `loudnessStatsOrder` array (full set of 12 ids) to panel controls as the single source of truth for display order. The panel renders metrics sorted by this order, then filtered to visible ids. The header "Stats" popover renders all 12 ids as a framer-motion `Reorder.Group`, each row with a drag handle + the existing visibility checkbox, plus a "Reset order" button.

**Tech Stack:** React 19, framer-motion `Reorder` (already a dependency), lucide-react icons, Vitest + Testing Library.

---

## File Structure

- `src/lib/panelControls.js` — add `loudnessStatsOrder` default + normalization (source of truth for order).
- `src/lib/panelControls.test.js` — update `DEFAULT_PANEL_CONTROLS` assertions; add order-normalization tests.
- `src/App.jsx` — expose `loudnessStatsOrder` on the AudioDataContext value.
- `src/components/panels/LoudnessStatsPanel.jsx` — render metrics in `loudnessStatsOrder`.
- `src/components/panels/LoudnessStatsPanel.test.jsx` — add ordered-render test.
- `src/components/PanelHeaderControls.jsx` — new `SortableStatsChip` for the stats popover (drag + checkbox + reset).
- `src/components/PanelHeaderControls.test.jsx` — mock framer-motion; add order/reset tests.

---

## Task 1: Data model — `loudnessStatsOrder` default + normalization

**Files:**
- Modify: `src/lib/panelControls.js`
- Test: `src/lib/panelControls.test.js`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the existing `describe("panelControls", ...)` block in `src/lib/panelControls.test.js`:

```js
it("defaults loudnessStatsOrder to the full LOUDNESS_STATS_ORDER", () => {
  expect(DEFAULT_PANEL_CONTROLS.loudnessStatsOrder).toEqual([
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
  ]);
});

it("normalizes loudnessStatsOrder: dedupe, drop unknown, backfill missing in default order", () => {
  const result = normalizePanelControls({
    loudnessStatsOrder: ["psr", "psr", "bogus", "integrated"],
  });
  // kept (deduped, unknown dropped) then missing ids appended in default order
  expect(result.loudnessStatsOrder).toEqual([
    "psr",
    "integrated",
    "momentary",
    "shortTerm",
    "momentaryMax",
    "shortTermMax",
    "lra",
    "plr",
    "dialogueCoverage",
    "dialogueIntegrated",
    "dialogueRange",
    "dialogueOffset",
  ]);
});

it("falls back to default loudnessStatsOrder when raw is not an array", () => {
  expect(normalizePanelControls({ loudnessStatsOrder: "nope" }).loudnessStatsOrder).toEqual(
    DEFAULT_PANEL_CONTROLS.loudnessStatsOrder
  );
});
```

Also update the existing `it("uses the agreed defaults", ...)` assertion so the `DEFAULT_PANEL_CONTROLS` deep-equal includes the new key. Replace the object passed to `toEqual` with:

```js
expect(DEFAULT_PANEL_CONTROLS).toEqual({
  vectorscopePair: { x: 0, y: 1 },
  spectrumChannel: { type: "pair", x: 0, y: 1 },
  spectrumView: "combined",
  spectrumPeakHold: false,
  loudnessStatsVisibleIds: [
    "momentary",
    "shortTerm",
    "integrated",
    "momentaryMax",
    "shortTermMax",
    "lra",
    "psr",
    "plr",
  ],
  loudnessStatsOrder: [
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
  ],
  loudnessHistoryVisibleLayerIds: ["momentary", "shortTerm", "ref"],
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/panelControls.test.js`
Expected: FAIL — `DEFAULT_PANEL_CONTROLS.loudnessStatsOrder` is `undefined`; normalization tests fail.

- [ ] **Step 3: Implement the data-model changes**

In `src/lib/panelControls.js`, add a `loudnessStatsOrder` default to `DEFAULT_PANEL_CONTROLS` (insert right after the `loudnessStatsVisibleIds` array, before `loudnessHistoryVisibleLayerIds`):

```js
  loudnessStatsOrder: [...LOUDNESS_STATS_ORDER],
```

Add a normalization helper near `normalizeKnownIds` (after it):

```js
function normalizeOrder(raw, orderTemplate) {
  const known = new Set(orderTemplate);
  const ordered = [];
  if (Array.isArray(raw)) {
    for (const id of raw) {
      if (known.has(id) && !ordered.includes(id)) {
        ordered.push(id);
      }
    }
  }
  for (const id of orderTemplate) {
    if (!ordered.includes(id)) {
      ordered.push(id);
    }
  }
  return ordered;
}
```

In `normalizePanelControls`, add the new field (place it right after `loudnessStatsVisibleIds`):

```js
    loudnessStatsOrder: normalizeOrder(raw?.loudnessStatsOrder, LOUDNESS_STATS_ORDER),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/panelControls.test.js`
Expected: PASS — all panelControls tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/panelControls.js src/lib/panelControls.test.js
git commit -m "feat(loudness): add loudnessStatsOrder to panel controls"
```

---

## Task 2: Render the panel in `loudnessStatsOrder`

**Files:**
- Modify: `src/App.jsx:1036`
- Modify: `src/components/panels/LoudnessStatsPanel.jsx`
- Test: `src/components/panels/LoudnessStatsPanel.test.jsx`

- [ ] **Step 1: Write the failing test**

Add this test inside `describe("LoudnessStatsPanel", ...)` in `src/components/panels/LoudnessStatsPanel.test.jsx`:

```js
it("renders visible metrics in loudnessStatsOrder, ignoring hidden ids", () => {
  render(
    <AudioDataContext.Provider
      value={{
        primaryMetrics,
        secondaryMetrics,
        loudnessStatsVisibleIds: ["momentary", "integrated", "psr"],
        loudnessStatsOrder: ["psr", "lra", "integrated", "momentary", "shortTerm"],
      }}
    >
      <LoudnessStatsPanel />
    </AudioDataContext.Provider>
  );

  const labels = screen
    .getAllByText(/Momentary|Integrated|Short-term Dynamics/)
    .map((el) => el.textContent);
  // ordered by loudnessStatsOrder (psr, integrated, momentary), hidden "lra"/"shortTerm" skipped
  expect(labels).toEqual(["Short-term Dynamics", "Integrated", "Momentary"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/components/panels/LoudnessStatsPanel.test.jsx`
Expected: FAIL — current render order is `allMetrics` order (`Momentary, Integrated, Short-term Dynamics`), not `loudnessStatsOrder`.

- [ ] **Step 3: Implement ordered rendering**

In `src/components/panels/LoudnessStatsPanel.jsx`, change the context destructure and the metric assembly (lines 52-56). Replace:

```js
  const { primaryMetrics, secondaryMetrics, loudnessStatsVisibleIds, dialogueActiveNow } =
    useAudioData();
  const visibleIds = Array.isArray(loudnessStatsVisibleIds) ? loudnessStatsVisibleIds : [];
  const allMetrics = [...primaryMetrics, ...secondaryMetrics];
  const visibleMetrics = allMetrics.filter((metric) => visibleIds.includes(metric.id));
```

with:

```js
  const {
    primaryMetrics,
    secondaryMetrics,
    loudnessStatsVisibleIds,
    loudnessStatsOrder,
    dialogueActiveNow,
  } = useAudioData();
  const visibleIds = Array.isArray(loudnessStatsVisibleIds) ? loudnessStatsVisibleIds : [];
  const allMetrics = [...primaryMetrics, ...secondaryMetrics];
  const metricById = new Map(allMetrics.map((metric) => [metric.id, metric]));
  const orderedMetrics = Array.isArray(loudnessStatsOrder)
    ? loudnessStatsOrder.map((id) => metricById.get(id)).filter(Boolean)
    : allMetrics;
  const visibleMetrics = orderedMetrics.filter((metric) => visibleIds.includes(metric.id));
```

- [ ] **Step 4: Wire `loudnessStatsOrder` onto the context value**

In `src/App.jsx`, in the `audioData` object (around line 1036, next to `loudnessStatsVisibleIds`), add:

```js
    loudnessStatsOrder: normalizedPanelControls.loudnessStatsOrder,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- src/components/panels/LoudnessStatsPanel.test.jsx`
Expected: PASS — including the existing tests (which pass no `loudnessStatsOrder`, so they fall back to `allMetrics` order).

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx src/components/panels/LoudnessStatsPanel.jsx src/components/panels/LoudnessStatsPanel.test.jsx
git commit -m "feat(loudness): render stats panel in loudnessStatsOrder"
```

---

## Task 3: Drag-reorder + Reset in the "Stats" popover

**Files:**
- Modify: `src/components/PanelHeaderControls.jsx`
- Test: `src/components/PanelHeaderControls.test.jsx`

- [ ] **Step 1: Write the failing tests**

At the very top of `src/components/PanelHeaderControls.test.jsx`, below the existing imports, add a framer-motion mock (matches the project convention of mocking framer-motion in jsdom tests):

```js
vi.mock("framer-motion", () => ({
  Reorder: {
    Group: ({ children, role, "aria-label": ariaLabel, className }) => (
      <div role={role} aria-label={ariaLabel} className={className}>
        {children}
      </div>
    ),
    Item: ({ children, className }) => <div className={className}>{children}</div>,
  },
  useDragControls: () => ({ start: () => {} }),
}));
```

Then add these tests inside `describe("PanelHeaderControls", ...)`:

```js
it("renders stat rows in loudnessStatsOrder", () => {
  render(
    <PanelHeaderControls
      activeTab="loudnessStats"
      panelControls={{
        ...DEFAULT_PANEL_CONTROLS,
        loudnessStatsOrder: ["psr", "momentary", "integrated"],
      }}
      onPanelControlsChange={vi.fn()}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Stats" }));
  const checkboxes = screen.getAllByRole("checkbox");
  // first three follow the custom order; backfill appends the rest
  expect(checkboxes.slice(0, 3).map((c) => c.textContent)).toEqual([
    "Short-term Dynamics",
    "Momentary",
    "Integrated",
  ]);
});

it("resets the order to LOUDNESS_STATS_ORDER", () => {
  const onPanelControlsChange = vi.fn();
  render(
    <PanelHeaderControls
      activeTab="loudnessStats"
      panelControls={{
        ...DEFAULT_PANEL_CONTROLS,
        loudnessStatsOrder: ["psr", "momentary", "integrated"],
      }}
      onPanelControlsChange={onPanelControlsChange}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Stats" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset order" }));

  expect(onPanelControlsChange).toHaveBeenCalledWith(
    expect.objectContaining({ loudnessStatsOrder: LOUDNESS_STATS_ORDER })
  );
});
```

Update the import on line 6 of the test file to also pull `LOUDNESS_STATS_ORDER`:

```js
import { DEFAULT_PANEL_CONTROLS, LOUDNESS_STATS_ORDER } from "@/lib/panelControls.js";
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/components/PanelHeaderControls.test.jsx`
Expected: FAIL — there is no "Reset order" button and rows are not ordered by `loudnessStatsOrder` (the current `MultiSelectChip` renders `LOUDNESS_STATS_OPTIONS` order and has no checkbox text in the asserted order).

- [ ] **Step 3: Implement the sortable stats chip**

In `src/components/PanelHeaderControls.jsx`:

Update imports. Change the lucide import (line 1) to:

```js
import { Check, GripVertical } from "lucide-react";
```

Add a framer-motion import below the existing imports:

```js
import { Reorder, useDragControls } from "framer-motion";
```

Add `LOUDNESS_STATS_ORDER` to the panelControls import (lines 13-17):

```js
import {
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  LOUDNESS_STATS_OPTIONS,
  LOUDNESS_STATS_ORDER,
  normalizePanelControls,
} from "@/lib/panelControls.js";
```

Add these two components just above `MultiSelectChip`:

```jsx
function SortableStatRow({ id, label, checked, onToggle }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-accent/40"
    >
      <span
        aria-hidden="true"
        onPointerDown={(event) => controls.start(event)}
        className="flex cursor-grab touch-none items-center text-muted-foreground"
      >
        <GripVertical className="size-3.5" />
      </span>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        className="flex min-w-0 flex-1 items-center gap-2 whitespace-nowrap rounded-sm px-1 py-1 text-left text-sm text-popover-foreground outline-none hover:text-accent-foreground"
        onClick={() => onToggle(id)}
      >
        <span className="flex size-4 items-center justify-center">
          {checked ? <Check aria-hidden="true" className="size-4" /> : null}
        </span>
        {label}
      </button>
    </Reorder.Item>
  );
}

function SortableStatsChip({ label, options, orderedIds, selectedIds, onToggle, onReorder, onResetOrder }) {
  const labelById = new Map(options.map((option) => [option.id, option.label]));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={CHIP_CLASS}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-auto min-w-[8rem] p-1">
        <Reorder.Group
          axis="y"
          values={orderedIds}
          onReorder={onReorder}
          role="group"
          aria-label={label}
          className="flex flex-col gap-0.5"
        >
          {orderedIds.map((id) => (
            <SortableStatRow
              key={id}
              id={id}
              label={labelById.get(id) ?? id}
              checked={selectedIds.includes(id)}
              onToggle={onToggle}
            />
          ))}
        </Reorder.Group>
        <button
          type="button"
          onClick={onResetOrder}
          className="mt-1 w-full rounded-sm px-2 py-1 text-left text-xs text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground"
        >
          Reset order
        </button>
      </PopoverContent>
    </Popover>
  );
}
```

Replace the entire `if (activeTab === "loudnessStats")` block (currently lines 151-174, the one returning `<MultiSelectChip label="Stats" .../>`) with:

```jsx
  if (activeTab === "loudnessStats") {
    if (!panelControls || typeof onPanelControlsChange !== "function") return null;

    const normalizedPanelControls = normalizePanelControls(panelControls);

    return (
      <SortableStatsChip
        label="Stats"
        options={LOUDNESS_STATS_OPTIONS}
        orderedIds={normalizedPanelControls.loudnessStatsOrder}
        selectedIds={normalizedPanelControls.loudnessStatsVisibleIds}
        onToggle={(id) => {
          onPanelControlsChange(
            normalizePanelControls({
              ...normalizedPanelControls,
              loudnessStatsVisibleIds: toggleId(
                normalizedPanelControls.loudnessStatsVisibleIds,
                id
              ),
            })
          );
        }}
        onReorder={(nextOrder) => {
          onPanelControlsChange(
            normalizePanelControls({
              ...normalizedPanelControls,
              loudnessStatsOrder: nextOrder,
            })
          );
        }}
        onResetOrder={() => {
          onPanelControlsChange(
            normalizePanelControls({
              ...normalizedPanelControls,
              loudnessStatsOrder: [...LOUDNESS_STATS_ORDER],
            })
          );
        }}
      />
    );
  }
```

Leave the `if (activeTab === "loudness")` block (the "Layers" `MultiSelectChip`) unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/components/PanelHeaderControls.test.jsx`
Expected: PASS — including the existing "renders Stats chip and toggles stat ids" and "passes audio panel control changes through LeafView" tests (the visibility-toggle path and its expected payload are unchanged because `DEFAULT_PANEL_CONTROLS` now carries the default `loudnessStatsOrder` and the handler preserves it).

- [ ] **Step 5: Commit**

```bash
git add src/components/PanelHeaderControls.jsx src/components/PanelHeaderControls.test.jsx
git commit -m "feat(loudness): drag-reorder + reset for stats popover"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full check suite**

Run: `npm test`
Expected: PASS — entire Vitest suite green.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual app verification**

Run: `npm run desktop`
Then, in the app:
1. Open the Loudness Stats panel header "Stats" popover.
2. Drag a metric by its grip handle to a new position; confirm the panel reorders live.
3. Toggle a metric off and back on; confirm it returns to its dragged position (not the end).
4. Click "Reset order"; confirm the popover and panel return to the default order.
5. Restart the app; confirm the custom order persisted.

Expected: all five behaviors hold.

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1), rendering (Task 2), popover drag + reset (Task 3), persistence (covered by reusing the existing `normalizePanelControls` → `writePersistedPanelControls` path, verified in Task 4 step 3.5). All spec sections mapped.
- **Type consistency:** `loudnessStatsOrder` (array of id strings), `normalizeOrder(raw, orderTemplate)`, `SortableStatsChip` props (`orderedIds`, `onReorder`, `onResetOrder`) used consistently across tasks.
- **Backfill guarantee:** `normalizeOrder` always returns the full set of 12 ids, so older persisted data and future-added metrics never produce a partial list.
