# Spectrum Max Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Superseded after execution.** All five tasks shipped, then the design changed on the evidence
> of a real device: Max Decay and Max Hold became one `Max` mode over one fill, and the held line
> was removed. See the Revision section of
> `docs/superpowers/specs/2026-08-25-spectrum-max-hold-design.md`. Tasks 1 and 4 still describe what
> is in the tree; Tasks 2, 3 and 5 describe the two-control version that no longer exists.

**Goal:** Add a cumulative Max Hold to the Spectrum panel and the Dock Spectrum module, drawn as a thin outline per curve and cleared by clicking it, leaving the existing decaying envelope (Max Decay) untouched.

**Architecture:** The hold is a per-panel Float32Array of per-band maxima, accumulated in the frontend from each frame's smoothed curve. In snapshot mode it is reconstructed from the frozen history through a bucketed prefix table, the same shape the Vectorscope's Polar Level hold already uses. Rust is not involved: Max Decay keeps using the engine's envelope exactly as today.

**Tech Stack:** React 19, Vitest + Testing Library, SVG rendering, Float32Array typed arrays.

**Spec:** `docs/superpowers/specs/2026-08-25-spectrum-max-hold-design.md`

---

## File structure

| File                                               | Responsibility                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/math/spectrumMaxHold.js` (create)             | Pure hold arithmetic: accumulate a live hold, build a snapshot prefix table, read the hold at a row. No React, no DOM. |
| `src/math/spectrumMaxHold.test.js` (create)        | Tests for the above, including a naive-fold oracle.                                                                    |
| `src/lib/panelControls.js` (modify)                | Rename the Max Decay row's key, add the Max Hold row.                                                                  |
| `src/dock/dockModuleControls.js` (modify)          | Move the Dock's legacy short names onto the renamed row, add the new key to the Dock's Spectrum subset.                |
| `src/components/PanelSettingsContent.jsx` (modify) | `SpectrumDisplaySettingsRows` gains the Max Hold toggle; both the panel and the Dock render it.                        |
| `src/components/panels/SpectrumPanel.jsx` (modify) | Live accumulation, the held lines, the click-to-clear hit paths.                                                       |
| `src/hooks/useSnapshot.js` (modify)                | `withMaxHold` option on the spectrum resolver, table cached per frozen history.                                        |
| `src/dock/modules/DockSpectrum.jsx` (modify)       | Live hold and click-to-clear in the strip.                                                                             |

Note on units: the history stores the **smoothed** curve (`FrameIntake` pushes `entry.smoothDb` as `dbList`), which is exactly what the live hold accumulates. Live and snapshot holds therefore fold the same numbers.

---

## Task 1: The hold arithmetic

**Files:**

- Create: `src/math/spectrumMaxHold.js`
- Test: `src/math/spectrumMaxHold.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/math/spectrumMaxHold.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  accumulateSpectrumMaxHold,
  buildSpectrumMaxHoldTable,
  spectrumMaxHoldAt,
} from "./spectrumMaxHold.js";

/** A stand-in for a frozen SpectrumHistorySlab: rowAt(index) is all the table builder needs. */
function fakeHistory(rows) {
  return {
    length: rows.length,
    rowAt(index) {
      if (index < 0 || index >= rows.length) return undefined;
      const row = rows[index];
      return { dbList: row.a, dbListB: row.b ?? [], bands: [], timestampMs: index };
    },
  };
}

/** The definition the table has to match: fold every row from 0 to index. */
function naiveFold(rows, index, plane) {
  const bandCount = rows[0][plane === "a" ? "a" : "b"]?.length ?? 0;
  const out = new Float32Array(bandCount).fill(-Infinity);
  for (let i = 0; i <= index; i += 1) {
    const values = rows[i][plane] ?? [];
    for (let band = 0; band < bandCount; band += 1) {
      const value = values[band];
      if (Number.isFinite(value) && value > out[band]) out[band] = value;
    }
  }
  return out;
}

describe("accumulateSpectrumMaxHold", () => {
  it("takes the per-band maximum across frames", () => {
    let held = accumulateSpectrumMaxHold(null, [-30, -50, -70]);
    held = accumulateSpectrumMaxHold(held, [-40, -20, -80]);

    expect(Array.from(held)).toEqual([-30, -20, -70]);
  });

  it("reuses the same buffer while the band count holds, so the live path stops allocating", () => {
    const first = accumulateSpectrumMaxHold(null, [-30, -50]);
    const second = accumulateSpectrumMaxHold(first, [-20, -60]);

    expect(second).toBe(first);
  });

  it("starts a new hold when the band count changes", () => {
    const first = accumulateSpectrumMaxHold(null, [-30, -50]);
    const second = accumulateSpectrumMaxHold(first, [-30, -50, -70]);

    expect(second).not.toBe(first);
    expect(Array.from(second)).toEqual([-30, -50, -70]);
  });

  it("leaves a band untouched when its incoming value is not finite", () => {
    let held = accumulateSpectrumMaxHold(null, [-30, -50]);
    held = accumulateSpectrumMaxHold(held, [Number.NaN, -Infinity]);

    expect(Array.from(held)).toEqual([-30, -50]);
  });

  it("holds a band that has never seen a finite value at -Infinity", () => {
    const held = accumulateSpectrumMaxHold(null, [Number.NaN, -20]);

    expect(held[0]).toBe(-Infinity);
    expect(held[1]).toBe(-20);
  });

  it("returns the previous hold unchanged for an empty row", () => {
    const first = accumulateSpectrumMaxHold(null, [-30]);

    expect(accumulateSpectrumMaxHold(first, [])).toBe(first);
    expect(accumulateSpectrumMaxHold(null, [])).toBeNull();
  });
});

describe("spectrumMaxHoldAt", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    a: [-60 + i, -40 - (i % 7), -80 + ((i * 3) % 11)],
    b: [-70 + ((i * 2) % 9), -50 + (i % 5), -90 + i],
  }));

  it("matches a naive fold at every row, with buckets smaller than the history", () => {
    const built = buildSpectrumMaxHoldTable(fakeHistory(rows), 4);

    for (let index = 0; index < rows.length; index += 1) {
      const held = spectrumMaxHoldAt(built, index);
      expect(Array.from(held.dbList)).toEqual(Array.from(naiveFold(rows, index, "a")));
      expect(Array.from(held.dbListB)).toEqual(Array.from(naiveFold(rows, index, "b")));
    }
  });

  it("matches a naive fold when one bucket covers the whole history", () => {
    const built = buildSpectrumMaxHoldTable(fakeHistory(rows), 1000);
    const held = spectrumMaxHoldAt(built, rows.length - 1);

    expect(Array.from(held.dbList)).toEqual(Array.from(naiveFold(rows, rows.length - 1, "a")));
  });

  it("returns null outside the history", () => {
    const built = buildSpectrumMaxHoldTable(fakeHistory(rows), 4);

    expect(spectrumMaxHoldAt(built, -1)).toBeNull();
    expect(spectrumMaxHoldAt(built, rows.length)).toBeNull();
  });

  it("leaves the second plane empty for a history whose rows carry one curve", () => {
    const singles = rows.map((row) => ({ a: row.a }));
    const built = buildSpectrumMaxHoldTable(fakeHistory(singles), 4);
    const held = spectrumMaxHoldAt(built, 10);

    expect(Array.from(held.dbList)).toEqual(Array.from(naiveFold(singles, 10, "a")));
    expect(held.dbListB.length).toBe(0);
  });

  it("handles an empty history", () => {
    const built = buildSpectrumMaxHoldTable(fakeHistory([]), 4);

    expect(built.length).toBe(0);
    expect(spectrumMaxHoldAt(built, 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/math/spectrumMaxHold.test.js`
Expected: FAIL — `Failed to resolve import "./spectrumMaxHold.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/math/spectrumMaxHold.js`:

```js
/**
 * Cumulative Max Hold for the Spectrum: the per-band maximum of the smoothed curve since the hold
 * was switched on or last cleared. Distinct from Max Decay, which is the engine's decaying peak
 * envelope and belongs to the Rust side.
 *
 * A band that has never carried a finite value holds -Infinity, which the display scale clamps to
 * the bottom of the range (see spectrumDbToYViewBox) — the hold reads as "nothing seen here",
 * which is what it is.
 */

const EMPTY_PLANE = new Float32Array(0);

/**
 * Folds one frame into the hold. Returns the same buffer when the band count is unchanged, so the
 * live path allocates once per hold rather than once per frame.
 *
 * @param {Float32Array|null} previous
 * @param {ArrayLike<number>} dbList
 * @returns {Float32Array|null}
 */
export function accumulateSpectrumMaxHold(previous, dbList) {
  const bandCount = dbList?.length ?? 0;
  if (bandCount === 0) return previous ?? null;

  const held =
    previous && previous.length === bandCount
      ? previous
      : new Float32Array(bandCount).fill(-Infinity);
  for (let band = 0; band < bandCount; band += 1) {
    const value = dbList[band];
    if (Number.isFinite(value) && value > held[band]) held[band] = value;
  }
  return held;
}

function foldRowInto(target, values) {
  const bandCount = target.length;
  for (let band = 0; band < bandCount; band += 1) {
    const value = values?.[band];
    if (Number.isFinite(value) && value > target[band]) target[band] = value;
  }
}

/**
 * One cumulative prefix per bucket of `bucketRows` rows, for both curves, over a frozen history.
 * Bucket `b` covers rows `[0, (b + 1) * bucketRows)`, so a query starts from the previous bucket
 * and replays fewer than `bucketRows` rows. Trades a table for the row scan a query would
 * otherwise do from row 0.
 *
 * @param {{ length: number, rowAt: (index: number) => object|undefined }} history
 * @param {number} bucketRows
 */
export function buildSpectrumMaxHoldTable(history, bucketRows) {
  const length = history?.length ?? 0;
  const firstRow = length > 0 ? history.rowAt(0) : null;
  const bandCount = firstRow?.dbList?.length ?? 0;
  const bandCountB = firstRow?.dbListB?.length ?? 0;
  const bucketCount = bandCount > 0 ? Math.ceil(length / bucketRows) : 0;

  const tableA = new Float32Array(bucketCount * bandCount).fill(-Infinity);
  const tableB = new Float32Array(bucketCount * bandCountB).fill(-Infinity);
  const runningA = new Float32Array(bandCount).fill(-Infinity);
  const runningB = new Float32Array(bandCountB).fill(-Infinity);

  for (let index = 0; index < length && bandCount > 0; index += 1) {
    const row = history.rowAt(index);
    foldRowInto(runningA, row?.dbList);
    if (bandCountB > 0) foldRowInto(runningB, row?.dbListB);
    if ((index + 1) % bucketRows === 0 || index === length - 1) {
      const bucket = Math.floor(index / bucketRows);
      tableA.set(runningA, bucket * bandCount);
      if (bandCountB > 0) tableB.set(runningB, bucket * bandCountB);
    }
  }

  return { tableA, tableB, bandCount, bandCountB, length, bucketRows, history };
}

/**
 * The hold as it stood at `index`: the previous bucket's prefix, then a replay of the rows since.
 * Exact — the bucket only saves work, it does not approximate.
 *
 * @returns {{ dbList: Float32Array, dbListB: Float32Array }|null}
 */
export function spectrumMaxHoldAt(built, index) {
  if (!built || index < 0 || index >= built.length) return null;
  const { tableA, tableB, bandCount, bandCountB, bucketRows, history } = built;

  const dbList = new Float32Array(bandCount).fill(-Infinity);
  const dbListB = bandCountB > 0 ? new Float32Array(bandCountB).fill(-Infinity) : EMPTY_PLANE;
  const bucket = Math.floor(index / bucketRows);
  if (bucket > 0) {
    dbList.set(tableA.subarray((bucket - 1) * bandCount, bucket * bandCount));
    if (bandCountB > 0) {
      dbListB.set(tableB.subarray((bucket - 1) * bandCountB, bucket * bandCountB));
    }
  }
  for (let rowIndex = bucket * bucketRows; rowIndex <= index; rowIndex += 1) {
    const row = history.rowAt(rowIndex);
    foldRowInto(dbList, row?.dbList);
    if (bandCountB > 0) foldRowInto(dbListB, row?.dbListB);
  }
  return { dbList, dbListB };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/math/spectrumMaxHold.test.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the merge gate**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/math/spectrumMaxHold.js src/math/spectrumMaxHold.test.js
git commit -m "feat(spectrum): add the cumulative Max Hold arithmetic" -m "The per-band maximum of the smoothed curve, plus the bucketed prefix table a snapshot needs to show the hold as it stood at a selected row. Nothing is wired yet." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The controls

Renames the existing decaying control so its key matches the label it has always carried, and adds the new one. The renamed key keeps its old names as aliases, so stored workspaces and presets carry over. `spectrumMaxHold` is never reused for the new control.

**Files:**

- Modify: `src/lib/panelControls.js`
- Modify: `src/dock/dockModuleControls.js`
- Modify: `src/components/PanelSettingsContent.jsx`
- Test: `src/lib/panelControls.test.js`, `src/dock/dockModuleControls.test.js`

- [ ] **Step 1: Write the failing tests**

Append to the `describe("spectrum display controls normalization", ...)` block in `src/lib/panelControls.test.js`:

```js
it("reads the old spectrumMaxHold key as Max Decay without switching on Max Hold", () => {
  const controls = normalizePanelControls({ spectrumMaxHold: true });

  expect(controls.spectrumMaxDecay).toBe(true);
  expect(controls.spectrumMaxHoldTrace).toBe(false);
  expect(controls).not.toHaveProperty("spectrumMaxHold");
});

it("still reads the older spectrumPeakHold key as Max Decay", () => {
  expect(normalizePanelControls({ spectrumPeakHold: true }).spectrumMaxDecay).toBe(true);
});

it("defaults Max Hold off and normalizes non-booleans", () => {
  expect(normalizePanelControls({}).spectrumMaxHoldTrace).toBe(false);
  expect(normalizePanelControls({ spectrumMaxHoldTrace: true }).spectrumMaxHoldTrace).toBe(true);
  expect(normalizePanelControls({ spectrumMaxHoldTrace: "yes" }).spectrumMaxHoldTrace).toBe(false);
});
```

Append to `describe("normalizeDockModuleControls", ...)` in `src/dock/dockModuleControls.test.js`:

```js
it("reads the Dock's short Max Decay names onto the renamed key", () => {
  expect(normalizeDockModuleControls("spectrum", { maxHold: true }).spectrumMaxDecay).toBe(true);
  expect(normalizeDockModuleControls("spectrum", { peakHold: true }).spectrumMaxDecay).toBe(true);
  expect(normalizeDockModuleControls("spectrum", { maxHold: true }).spectrumMaxHoldTrace).toBe(
    false
  );
});

it("carries Max Hold in the Dock Spectrum subset", () => {
  expect(
    normalizeDockModuleControls("spectrum", { spectrumMaxHoldTrace: true }).spectrumMaxHoldTrace
  ).toBe(true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/panelControls.test.js src/dock/dockModuleControls.test.js`
Expected: FAIL — `expected undefined to be true` on `spectrumMaxDecay`.

- [ ] **Step 3: Rename the row and add the new one**

In `src/lib/panelControls.js`, replace the existing `spectrumMaxHold` row:

```js
  {
    /// spectrumMaxDecay was spectrumMaxHold, which was spectrumPeakHold before that. The label has
    /// always read "Max Decay": this is the engine's decaying peak envelope, and since a real
    /// cumulative Max Hold now exists beside it, a key reading spectrumMaxHold for the decaying
    /// one would mislead every later reader. The old names are read here and nowhere else -- in
    /// particular spectrumMaxHold is never reused for the new control, because a stored `true`
    /// means the user had Max Decay on and must not switch on something they have never seen.
    key: "spectrumMaxDecay",
    kind: "boolean",
    default: false,
    legacyKeys: ["spectrumMaxHold", "spectrumPeakHold"],
  },
  {
    /// The cumulative hold: the maximum since it was switched on or cleared, accumulated in the
    /// frontend and drawn as an outline. See docs/superpowers/specs/2026-08-25-spectrum-max-hold-design.md.
    key: "spectrumMaxHoldTrace",
    kind: "boolean",
    default: false,
  },
```

- [ ] **Step 4: Move the Dock's short names and add the new key**

In `src/dock/dockModuleControls.js`:

In `DOCK_MODULE_CONTROL_KEYS.spectrum`, replace `"spectrumMaxHold",` with:

```js
    "spectrumMaxDecay",
    "spectrumMaxHoldTrace",
```

In `LEGACY_DOCK_KEYS.spectrum`, replace `spectrumMaxHold: ["maxHold", "peakHold"],` with:

```js
    spectrumMaxDecay: ["maxHold", "peakHold"],
```

- [ ] **Step 5: Add the settings toggle**

In `src/components/PanelSettingsContent.jsx`, `SpectrumDisplaySettingsRows`:

Rename the incoming props `maxHold` / `onMaxHoldChange` to `maxDecay` / `onMaxDecayChange`, add `maxHoldTrace` / `onMaxHoldTraceChange` to the parameter list, and replace the Max Decay row with:

```jsx
{
  showPeak ? (
    <>
      <SettingsRow
        label="Max Decay"
        tooltip="Holds each band's peak briefly, then lets it fall. Shows the last few seconds."
      >
        <SettingsSwitch
          aria-label="spectrum max decay"
          checked={maxDecay}
          onCheckedChange={onMaxDecayChange}
        />
      </SettingsRow>
      <SettingsRow
        label="Max Hold"
        tooltip="Keeps the highest level each band has reached since it was switched on. Click the held line to clear it."
      >
        <SettingsSwitch
          aria-label="spectrum max hold"
          checked={maxHoldTrace}
          onCheckedChange={onMaxHoldTraceChange}
        />
      </SettingsRow>
    </>
  ) : null;
}
```

Update the Peak Labels tooltip in the same component, replacing "Max Decay is the time axis; this is the frequency axis." with "Max Decay and Max Hold are the time axis; this is the frequency axis."

Then update both call sites of `SpectrumDisplaySettingsRows` — in `PanelSettingsContent`'s spectrum branch and in `src/dock/editors/DockModuleSettings.jsx` — to pass the renamed props and the new pair. In the panel branch the existing `effectiveSpectrumMaxHold` value and `onSpectrumMaxHoldToggle` callback belong to Max Decay and keep that role; the new toggle commits `spectrumMaxHoldTrace` through `onPanelControlsChange` the same way `spectrumPeakLabels` does.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib src/dock src/components`
Expected: PASS. Fixture updates in `SpectrumPanel.test.jsx`, `DockSpectrum.test.jsx`, `useDockLayout.test.js` and `dockModuleControls.test.js` that name `spectrumMaxHold` must be renamed to `spectrumMaxDecay`; that rename is part of this task.

- [ ] **Step 7: Run the merge gate**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(spectrum): add the Max Hold control beside Max Decay" -m "The decaying control moves to spectrumMaxDecay, the key its label has always claimed, keeping spectrumMaxHold and spectrumPeakHold as aliases so stored workspaces and presets carry over. spectrumMaxHold is retired rather than reused: a stored true means Max Decay was on." -m "The new spectrumMaxHoldTrace control is off by default and draws nothing yet." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: The held lines in the panel

**Files:**

- Modify: `src/components/panels/SpectrumPanel.jsx`
- Test: `src/components/panels/SpectrumPanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/components/panels/SpectrumPanel.test.jsx`. The existing helpers there are
`renderPanel(audioData)` and `spectrumPanelTree(audioData)`, which take one flat object splitting
into `{ panelControls, analysisStatus, onPanelControlsChange, displayAudio, ...historyData }`, plus
`liveResult(over)` and the `LIVE_KEY` constant for the default controls. `LIVE_KEY` is derived from
the controls, so the L/R cases compute their own key with `spectrumRequestKeyFromControls`.

```js
function heldPath(container, plane) {
  return container.querySelector(`[data-spectrum-max-hold="${plane}"]`)?.getAttribute("d");
}

it("draws a held line from the accumulated hold, not from the frame's decaying peak", () => {
  const panelControls = { ...DEFAULT_PANEL_CONTROLS, spectrumMaxHoldTrace: true };
  const audioData = {
    panelControls,
    displayAudio: {
      spectrumResultsByKey: {
        [LIVE_KEY]: liveResult({ smoothDb: [-30, -50], peakDb: [-10, -10] }),
      },
    },
  };
  const { container, rerender } = renderPanel(audioData);
  rerender(
    spectrumPanelTree({
      ...audioData,
      displayAudio: {
        spectrumResultsByKey: {
          [LIVE_KEY]: liveResult({ smoothDb: [-40, -20], peakDb: [-10, -10] }),
        },
      },
    })
  );

  // The hold is the max of the two smoothed frames, so it follows neither frame on its own.
  expect(heldPath(container, "primary")).toBeTruthy();
  expect(heldPath(container, "primary")).not.toBe(
    container.querySelector('[data-spectrum-live="primary"]').getAttribute("d")
  );
});

it("draws one held line in Combined view and two in L/R", () => {
  const combined = renderPanel({
    panelControls: { ...DEFAULT_PANEL_CONTROLS, spectrumMaxHoldTrace: true },
    displayAudio: {
      spectrumResultsByKey: { [LIVE_KEY]: liveResult({ smoothDb: [-30, -50] }) },
    },
  });
  expect(combined.container.querySelectorAll("[data-spectrum-max-hold]")).toHaveLength(1);
  combined.unmount();

  const lrControls = {
    ...DEFAULT_PANEL_CONTROLS,
    spectrumMaxHoldTrace: true,
    spectrumView: "lr",
  };
  const lrKey = spectrumRequestKeyFromControls(lrControls);
  const lr = renderPanel({
    panelControls: lrControls,
    displayAudio: {
      spectrumResultsByKey: {
        [lrKey]: liveResult({ smoothDb: [-30, -50], smoothDbB: [-35, -55] }),
      },
    },
  });
  expect(lr.container.querySelectorAll("[data-spectrum-max-hold]")).toHaveLength(2);
});

it("clears both held lines on a click and does not capture a snapshot", () => {
  const captureCurrentSnapshot = vi.fn();
  const lrControls = {
    ...DEFAULT_PANEL_CONTROLS,
    spectrumMaxHoldTrace: true,
    spectrumView: "lr",
  };
  const lrKey = spectrumRequestKeyFromControls(lrControls);
  const audioData = {
    panelControls: lrControls,
    captureCurrentSnapshot,
    totalSamples: 10,
    displayAudio: {
      spectrumResultsByKey: {
        [lrKey]: liveResult({ smoothDb: [-30, -50], smoothDbB: [-35, -55] }),
      },
    },
  };
  const { container, rerender } = renderPanel(audioData);
  rerender(
    spectrumPanelTree({
      ...audioData,
      displayAudio: {
        spectrumResultsByKey: {
          [lrKey]: liveResult({ smoothDb: [-40, -20], smoothDbB: [-45, -25] }),
        },
      },
    })
  );

  fireEvent.click(container.querySelector('[data-spectrum-max-hold-hit="primary"]'));

  expect(captureCurrentSnapshot).not.toHaveBeenCalled();
  // Cleared, so the hold now holds only the newest frame and tracks the live curve.
  expect(heldPath(container, "primary")).toBe(
    container.querySelector('[data-spectrum-live="primary"]').getAttribute("d")
  );
  expect(heldPath(container, "secondary")).toBe(
    container.querySelector('[data-spectrum-live="secondary"]').getAttribute("d")
  );
});

it("has no held line or hit path while Max Hold is off", () => {
  const { container } = renderPanel({
    panelControls: { ...DEFAULT_PANEL_CONTROLS, spectrumMaxHoldTrace: false },
    displayAudio: {
      spectrumResultsByKey: { [LIVE_KEY]: liveResult({ smoothDb: [-30, -50] }) },
    },
  });

  expect(container.querySelector("[data-spectrum-max-hold]")).toBeNull();
  expect(container.querySelector("[data-spectrum-max-hold-hit]")).toBeNull();
});

it("keeps drawing the Max Decay fill while Max Hold is on", () => {
  const { container } = renderPanel({
    panelControls: {
      ...DEFAULT_PANEL_CONTROLS,
      spectrumMaxDecay: true,
      spectrumMaxHoldTrace: true,
    },
    displayAudio: {
      spectrumResultsByKey: {
        [LIVE_KEY]: liveResult({ smoothDb: [-30, -50], peakDb: [-10, -20] }),
      },
    },
  });

  expect(container.querySelector('[data-spectrum-max-decay="primary"]')).toBeTruthy();
  expect(container.querySelector('[data-spectrum-max-hold="primary"]')).toBeTruthy();
});
```

Add `fireEvent` to the `@testing-library/react` import, `vi` to the `vitest` import, and
`spectrumRequestKeyFromControls` from `../../analysis/analysisRequests.js`, if that file does not
already import them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/panels/SpectrumPanel.test.jsx`
Expected: FAIL — the `[data-spectrum-max-hold]` queries return null.

- [ ] **Step 3: Accumulate the hold**

In `src/components/panels/SpectrumPanel.jsx`, import the arithmetic:

```js
import { accumulateSpectrumMaxHold } from "../../math/spectrumMaxHold.js";
```

Add refs and a clear counter next to the existing `holdDisplaySpectrumResultRef`:

```js
const maxHoldRef = useRef(null);
const maxHoldRefB = useRef(null);
const [maxHoldClearKey, setMaxHoldClearKey] = useState(0);
```

Accumulate during render, from the same data the live curve draws. Place this immediately after `panelSpectrumData` is assigned:

```js
// The hold folds the smoothed curve the panel is about to draw, which is also what the history
// stores, so the live hold and the snapshot reconstruction fold the same numbers.
const maxHoldEnabled = normalizedPanelControls.spectrumMaxHoldTrace;
if (!maxHoldEnabled || isSnapshot) {
  maxHoldRef.current = null;
  maxHoldRefB.current = null;
} else if (panelSpectrumData?.dbList?.length) {
  maxHoldRef.current = accumulateSpectrumMaxHold(maxHoldRef.current, panelSpectrumData.dbList);
  maxHoldRefB.current = panelSpectrumData.dbListB?.length
    ? accumulateSpectrumMaxHold(maxHoldRefB.current, panelSpectrumData.dbListB)
    : null;
}
```

Clear on an analysis-key change and on the clear gesture:

```js
useEffect(() => {
  maxHoldRef.current = null;
  maxHoldRefB.current = null;
}, [spectrumKey, maxHoldClearKey, maxHoldEnabled]);
```

- [ ] **Step 4: Build the held paths**

Next to the existing `displayPanelSpectrumPeakPath` block:

```js
const heldValues = isSnapshot ? snapResolved?.maxHold : null;
const maxHoldDb = isSnapshot ? heldValues?.dbList : maxHoldRef.current;
const maxHoldDbB = isSnapshot ? heldValues?.dbListB : maxHoldRefB.current;
const displaySpectrumMaxHoldPath =
  maxHoldEnabled && maxHoldDb?.length
    ? buildSpectrumPathFromData(panelSpectrumData, maxHoldDb, spectrumRange)
    : "";
const displaySpectrumMaxHoldPathB =
  maxHoldEnabled && maxHoldDbB?.length
    ? buildSpectrumPathFromData(panelSpectrumData, maxHoldDbB, spectrumRange)
    : "";
```

(`snapResolved.maxHold` arrives in Task 4; until then it is undefined and the snapshot simply draws no held line.)

- [ ] **Step 5: Render the lines and the hit paths**

Inside the `motion.g`, after the existing curve paths, and add `data-spectrum-live="primary"` / `"secondary"` to the two existing live curve paths and `data-spectrum-max-decay="primary"` / `"secondary"` to the two existing fill paths so the tests can name them:

```jsx
{
  displaySpectrumMaxHoldPath ? (
    <>
      <path
        data-spectrum-max-hold="primary"
        d={displaySpectrumMaxHoldPath}
        fill="none"
        stroke={
          selectedOffset >= 0 ? "var(--ui-spectrum-primary-snap)" : "var(--ui-spectrum-primary)"
        }
        strokeOpacity="0.7"
        strokeWidth="var(--ui-spectrum-stroke-width)"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Hit target: stroke only, so the click lands on the line and not on
                                the chart, whose own click captures a snapshot. */}
      {clearMaxHoldOnClick ? (
        <path
          data-spectrum-max-hold-hit="primary"
          d={displaySpectrumMaxHoldPath}
          fill="none"
          stroke="transparent"
          strokeWidth="10"
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "stroke", cursor: "pointer" }}
          onClick={onMaxHoldClearClick}
        />
      ) : null}
    </>
  ) : null;
}
{
  displaySpectrumMaxHoldPathB ? (
    <>
      <path
        data-spectrum-max-hold="secondary"
        d={displaySpectrumMaxHoldPathB}
        fill="none"
        stroke={
          selectedOffset >= 0 ? "var(--ui-spectrum-secondary-snap)" : "var(--ui-spectrum-secondary)"
        }
        strokeOpacity="0.7"
        strokeWidth="var(--ui-spectrum-stroke-width)"
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {clearMaxHoldOnClick ? (
        <path
          data-spectrum-max-hold-hit="secondary"
          d={displaySpectrumMaxHoldPathB}
          fill="none"
          stroke="transparent"
          strokeWidth="10"
          vectorEffect="non-scaling-stroke"
          style={{ pointerEvents: "stroke", cursor: "pointer" }}
          onClick={onMaxHoldClearClick}
        />
      ) : null}
    </>
  ) : null;
}
```

With, next to the other callbacks:

```js
// Live only: in snapshot the held line is reconstructed from history, so there is nothing here
// to clear.
const clearMaxHoldOnClick = maxHoldEnabled && !isSnapshot;
const onMaxHoldClearClick = useCallback((event) => {
  // The chart's own click captures a snapshot; this click is not that.
  event.stopPropagation();
  setMaxHoldClearKey((key) => key + 1);
}, []);
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/components/panels/SpectrumPanel.test.jsx`
Expected: PASS.

- [ ] **Step 7: Add the help line**

In `src/components/panels/chartHelp.js`, add to the Spectrum help's interaction section:

```js
      "Click held line - Clear Max Hold",
```

Run: `npx vitest run src/components/panels`
Expected: PASS; update the help snapshot assertions in that suite if they enumerate the lines.

- [ ] **Step 8: Run the merge gate**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(spectrum): draw and clear the live Max Hold" -m "One held outline per curve, in the curve's own colour, accumulated from the smoothed curve the panel draws. Clicking a held line clears both: the target is a stroke-only hit path that stops the click reaching the chart, whose own click captures a snapshot." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: The hold in snapshot mode

**Files:**

- Modify: `src/hooks/useSnapshot.js`
- Modify: `src/components/panels/SpectrumPanel.jsx` (pass `withMaxHold`)
- Test: `src/hooks/useSnapshot.test.jsx`

- [ ] **Step 1: Write the failing test**

Add to `src/hooks/useSnapshot.test.jsx`, matching the file's existing harness for `resolveSpectrumSnapshotForKey`:

```js
it("reconstructs the spectrum Max Hold at the selected row", () => {
  const rows = [
    { dbList: [-30, -50], dbListB: [] },
    { dbList: [-40, -20], dbListB: [] },
    { dbList: [-35, -60], dbListB: [] },
  ];
  const { result } = renderSnapshotHook({ spectrumRows: rows, selectedIndex: 1 });

  const resolved = result.current.resolveSpectrumSnapshotForKey("spectrum:test", {
    withMaxHold: true,
  });

  expect(Array.from(resolved.maxHold.dbList)).toEqual([-30, -20]);
});

it("builds no Max Hold table when no panel asks for one", () => {
  const rows = [{ dbList: [-30, -50], dbListB: [] }];
  const { result } = renderSnapshotHook({ spectrumRows: rows, selectedIndex: 0 });

  expect(result.current.resolveSpectrumSnapshotForKey("spectrum:test").maxHold).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/useSnapshot.test.jsx`
Expected: FAIL — `Cannot read properties of undefined (reading 'dbList')`.

- [ ] **Step 3: Wire the table into the resolver**

In `src/hooks/useSnapshot.js`, import beside the existing polar import:

```js
import { buildSpectrumMaxHoldTable, spectrumMaxHoldAt } from "../math/spectrumMaxHold.js";
```

Add the cache and the accessor next to `maxHoldEnvelopeFor`:

```js
const spectrumMaxHoldTableCacheRef = useRef(new WeakMap());
// 40 s per bucket: the table stays small enough to keep (about 2.8 MB for two planes at the
// four-hour retention) while a query replays at most a thousand rows.
const SPECTRUM_MAX_HOLD_BUCKET_ROWS = 1000;
const spectrumMaxHoldFor = useCallback((entries, index) => {
  if (!entries || index < 0) return null;
  const cache = spectrumMaxHoldTableCacheRef.current;
  let table = cache.get(entries);
  if (!table) {
    table = buildSpectrumMaxHoldTable(entries, SPECTRUM_MAX_HOLD_BUCKET_ROWS);
    cache.set(entries, table);
  }
  return spectrumMaxHoldAt(table, index);
}, []);
```

Give `resolveSpectrumSnapshotForKey` the option, mirroring the Vectorscope resolver's `withMaxHold` caching so a panel with the feature off never pays:

```js
  const resolveSpectrumSnapshotForKey = useCallback(
    (key, { withMaxHold = false } = {}) => {
```

and in the resolved result add:

```js
          maxHold: withMaxHold ? spectrumMaxHoldFor(entries, index) : null,
```

for both the `missing` branch (`maxHold: null`) and the resolved branch. Key the per-key cache on `withMaxHold` the same way the Vectorscope resolver does, so one panel asking with the hold on and another with it off do not overwrite each other's cached result.

- [ ] **Step 4: Ask for it from the panel**

In `src/components/panels/SpectrumPanel.jsx`, pass the option:

```js
const snapResolved = isSnapshot
  ? resolveSpectrumSnapshotForKey?.(spectrumKey, { withMaxHold: maxHoldEnabled })
  : null;
```

`maxHoldEnabled` is declared above this line in Task 3; if it is not, move its declaration up.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/hooks/useSnapshot.test.jsx src/components/panels/SpectrumPanel.test.jsx`
Expected: PASS.

- [ ] **Step 6: Run the merge gate**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(spectrum): reconstruct Max Hold in snapshot mode" -m "The held lines in a snapshot show the hold as it stood at the selected row, folded from the frozen history through a bucketed prefix table cached against that history. Built only when a panel with Max Hold on asks, so scrubbing without the feature costs nothing." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: The Dock module

The Dock has no snapshot, so only the live half applies.

**Files:**

- Modify: `src/dock/modules/DockSpectrum.jsx`
- Test: `src/dock/modules/DockSpectrum.test.jsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/dock/modules/DockSpectrum.test.jsx`. Its helper is `renderSpectrum(controls, result)`,
with positional arguments, and the controls are spread from
`DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum` because `dockSpectrumKey(controls)` needs a full
record.

```js
it("draws a held outline when Max Hold is on", () => {
  const controls = {
    ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum,
    spectrumMaxHoldTrace: true,
  };
  const { container } = renderSpectrum(controls, {
    bandCentersHz: [100, 1000],
    smoothDb: [-30, -50],
  });

  expect(container.querySelector("[data-dock-spectrum-max-hold]")).toBeTruthy();
});

it("draws no held outline when Max Hold is off", () => {
  const controls = {
    ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum,
    spectrumMaxHoldTrace: false,
  };
  const { container } = renderSpectrum(controls, {
    bandCentersHz: [100, 1000],
    smoothDb: [-30, -50],
  });

  expect(container.querySelector("[data-dock-spectrum-max-hold]")).toBeNull();
});

it("clears the hold on a click", () => {
  const controls = {
    ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum,
    spectrumMaxHoldTrace: true,
  };
  const { container, rerender } = renderSpectrum(controls, {
    bandCentersHz: [100, 1000],
    smoothDb: [-30, -50],
  });
  rerender(
    <FrameDataProvider
      value={{
        displayAudio: {
          spectrumResultsByKey: {
            [dockSpectrumKey(controls)]: { bandCentersHz: [100, 1000], smoothDb: [-40, -20] },
          },
        },
      }}
    >
      <DockSpectrum controls={controls} />
    </FrameDataProvider>
  );
  fireEvent.click(container.querySelector("[data-dock-spectrum-max-hold-hit]"));

  expect(container.querySelector("[data-dock-spectrum-max-hold]").getAttribute("d")).toBe(
    container.querySelector("[data-dock-spectrum-live]").getAttribute("d")
  );
});
```

Add `fireEvent` to the `@testing-library/react` import in that file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/dock/modules/DockSpectrum.test.jsx`
Expected: FAIL — the queries return null.

- [ ] **Step 3: Implement**

In `src/dock/modules/DockSpectrum.jsx`, accumulate the same way the panel does and render the outline plus its hit path:

```js
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { accumulateSpectrumMaxHold } from "../../math/spectrumMaxHold.js";
```

```js
const maxHoldRef = useRef(null);
const [maxHoldClearKey, setMaxHoldClearKey] = useState(0);
const maxHoldEnabled = controls?.spectrumMaxHoldTrace === true;
const key = dockSpectrumKey(controls);
useEffect(() => {
  maxHoldRef.current = null;
}, [key, maxHoldClearKey, maxHoldEnabled]);
if (!maxHoldEnabled) {
  maxHoldRef.current = null;
} else if (result?.smoothDb?.length) {
  maxHoldRef.current = accumulateSpectrumMaxHold(maxHoldRef.current, result.smoothDb);
}
const maxHoldPath =
  maxHoldEnabled && maxHoldRef.current
    ? buildSpectrumSvgFromBandsAndDb(
        result?.bandCentersHz ?? [],
        Array.from(maxHoldRef.current),
        range
      )
    : "";
const onMaxHoldClear = useCallback(() => setMaxHoldClearKey((value) => value + 1), []);
```

Add `data-dock-spectrum-live` to the existing live path, and render after it:

```jsx
{
  maxHoldPath ? (
    <>
      <path
        data-dock-spectrum-max-hold=""
        d={maxHoldPath}
        fill="none"
        stroke="var(--ui-spectrum-primary)"
        strokeOpacity="0.7"
        strokeWidth="var(--ui-spectrum-stroke-width)"
        vectorEffect="non-scaling-stroke"
      />
      <path
        data-dock-spectrum-max-hold-hit=""
        d={maxHoldPath}
        fill="none"
        stroke="transparent"
        strokeWidth="10"
        vectorEffect="non-scaling-stroke"
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
        onClick={onMaxHoldClear}
      />
    </>
  ) : null;
}
```

The module's `<svg>` carries `aria-hidden="true"`; leave that as it is and let the hit path be a pointer-only affordance, matching `DockVectorscope`.

Before writing the click handler, check `src/dock/DockStrip.jsx` for a click handler on the module body that this one would have to stop propagating to. If there is one, add `event.stopPropagation()` here; if not, leave the handler as written and note it in the commit message.

The Dock draws only the primary curve today, so there is one held line here, not two.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/dock`
Expected: PASS.

- [ ] **Step 5: Run the merge gate**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(dock): hold the spectrum peak in the strip" -m "The Dock Spectrum module gets the same cumulative hold and click-to-clear as the panel, so the strip and the panel do not disagree about what the held curve means. The strip draws the primary curve only, so there is one held line." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## After the plan

Ask the user to check on a real device (`npm run desktop`):

1. Max Decay still behaves exactly as before, on its own.
2. Max Hold rises and never falls; clicking a held line clears both lines.
3. Clicking the chart away from the line still captures a snapshot.
4. In L/R and M/S there are two held lines; in Combined, one.
5. Scrubbing a snapshot with Max Hold on shows the hold at the selected point, and the first scrub after entering the snapshot may pause briefly while the table builds.
6. Whether the held line is readable in the Dock strip at all — if not, Task 5's commit reverts cleanly on its own.

No soak run is needed: nothing in this work touches the capture layer or the ingest path.
