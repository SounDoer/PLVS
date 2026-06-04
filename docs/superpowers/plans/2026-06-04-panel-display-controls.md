# Panel Display Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unified panel header controls for channel, stats, and loudness history layer visibility, with persisted user preferences and custom preset capture.

**Architecture:** Introduce a normalized `panelControls` object shared by app state, workspace state, localStorage persistence, and custom presets. Replace `PanelChannelSelector` with `PanelHeaderControls`, which delegates to single-select and multi-select header controls while leaving metric calculation, chart rendering, persistence, and backend side effects in existing owners. Built-in presets keep current panel controls; custom presets save and restore them.

**Tech Stack:** React 19, Radix Select/Popover wrappers, lucide-react icons, Vitest + Testing Library, localStorage persistence, existing workspace reducer.

---

## File Structure

- Create `src/lib/panelControls.js`
  - Owns `DEFAULT_PANEL_CONTROLS`, option ids, normalization, and `plvs.ui` read/write helpers.
  - No React imports.
- Create `src/lib/panelControls.test.js`
  - Covers defaults, normalization, persistence, and no old-key migration.
- Rename or replace `src/components/PanelChannelSelector.jsx` with `src/components/PanelHeaderControls.jsx`
  - Renders active panel header controls.
  - Contains `PanelSingleSelectControl` and `PanelMultiSelectControl`.
- Replace `src/components/PanelChannelSelector.test.jsx` with `src/components/PanelHeaderControls.test.jsx`
  - Preserves existing channel behavior tests and adds `Stats`/`Layers`.
- Modify `src/workspace/constants.js`
  - Add default `panelControls` to `DEFAULT_WORKSPACE_STATE`.
- Modify `src/workspace/types.js`
  - Document `panelControls` on workspace state and custom presets.
- Modify `src/workspace/reducer.js`
  - Add `SET_PANEL_CONTROLS`.
  - Save panel controls into custom presets.
  - Restore panel controls from custom presets only.
- Modify `src/workspace/reducer-tree.test.js`
  - Cover save/restore/built-in behavior and non-dirty panel control edits.
- Modify `src/workspace/LeafView.jsx`
  - Render `PanelHeaderControls` instead of `PanelChannelSelector`.
- Modify `src/App.jsx`
  - Initialize and persist `panelControls`.
  - Mirror normalized changes into workspace state.
  - Derive channel, stats, and layer props from `panelControls`.
  - Keep backend channel commands and snapshot exit behavior.
- Modify `src/hooks/useLoudnessHistory.js`
  - Remove internal `histCurves` state and `toggleCurve`.
  - Continue returning full metric lists and chart paths.
- Modify `src/components/panels/LoudnessStatsPanel.jsx`
  - Filter visible rows by `loudnessStatsVisibleIds`.
  - Make metric rows pure display.
  - Render empty state when all stats are hidden.
- Create `src/components/panels/LoudnessStatsPanel.test.jsx`
  - Cover filtering and empty state.
- Modify `src/components/panels/LoudnessPanel.jsx`
  - Pass layer visibility into `LoudnessHistoryChart`.
- Modify `src/components/panels/LoudnessHistoryChart.jsx`
  - Render Momentary, Short-term, and Reference based on visible layers.
  - Render empty layer state when all layers are hidden.
- Create `src/components/panels/LoudnessHistoryChart.test.jsx`
  - Cover M/ST/reference visibility and empty state.

---

## Task 1: Panel Controls Helpers

**Files:**
- Create: `src/lib/panelControls.js`
- Create: `src/lib/panelControls.test.js`

- [ ] **Step 1: Write failing helper tests**

Create `src/lib/panelControls.test.js`:

```js
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_CONTROLS,
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  LOUDNESS_STATS_OPTIONS,
  normalizePanelControls,
  readPersistedPanelControls,
  writePersistedPanelControls,
} from "./panelControls.js";
import { UI_PREFERENCES } from "../uiPreferences.js";

describe("panelControls", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defines stable stats and layer option ids", () => {
    expect(LOUDNESS_STATS_OPTIONS.map((o) => o.id)).toEqual([
      "momentary",
      "shortTerm",
      "integrated",
      "momentaryMax",
      "shortTermMax",
      "lra",
      "psr",
      "plr",
    ]);
    expect(LOUDNESS_HISTORY_LAYER_OPTIONS.map((o) => o.id)).toEqual([
      "momentary",
      "shortTerm",
      "ref",
    ]);
  });

  it("uses the agreed defaults", () => {
    expect(DEFAULT_PANEL_CONTROLS).toEqual({
      vectorscopePair: { x: 0, y: 1 },
      spectrumChannel: { type: "pair", x: 0, y: 1 },
      loudnessStatsVisibleIds: ["momentary", "shortTerm", "integrated", "lra"],
      loudnessHistoryVisibleLayerIds: ["shortTerm", "ref"],
    });
  });

  it("normalizes invalid input without preserving unknown ids", () => {
    expect(
      normalizePanelControls({
        vectorscopePair: { x: 2, y: "bad" },
        spectrumChannel: { type: "single", ch: 3 },
        loudnessStatsVisibleIds: ["momentary", "unknown", "momentary"],
        loudnessHistoryVisibleLayerIds: ["ref", "bad", "ref"],
      })
    ).toEqual({
      vectorscopePair: { x: 0, y: 1 },
      spectrumChannel: { type: "single", ch: 3 },
      loudnessStatsVisibleIds: ["momentary"],
      loudnessHistoryVisibleLayerIds: ["ref"],
    });
  });

  it("reads defaults when plvs.ui has only old channel keys", () => {
    localStorage.setItem(
      UI_PREFERENCES.layoutPersistKey,
      JSON.stringify({
        vectorscopePairX: 2,
        vectorscopePairY: 3,
        spectrumChannelType: "single",
        spectrumChannelCh: 2,
      })
    );

    expect(readPersistedPanelControls()).toEqual(DEFAULT_PANEL_CONTROLS);
  });

  it("writes panelControls while preserving unrelated persisted settings", () => {
    localStorage.setItem(
      UI_PREFERENCES.layoutPersistKey,
      JSON.stringify({ appearance: "fixed", referenceLufs: -18 })
    );

    writePersistedPanelControls({
      ...DEFAULT_PANEL_CONTROLS,
      loudnessStatsVisibleIds: [],
      loudnessHistoryVisibleLayerIds: ["momentary"],
    });

    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES.layoutPersistKey))).toEqual({
      appearance: "fixed",
      referenceLufs: -18,
      panelControls: {
        ...DEFAULT_PANEL_CONTROLS,
        loudnessStatsVisibleIds: [],
        loudnessHistoryVisibleLayerIds: ["momentary"],
      },
    });
  });
});
```

- [ ] **Step 2: Run helper tests to verify failure**

Run: `npm test -- src/lib/panelControls.test.js`

Expected: FAIL because `src/lib/panelControls.js` does not exist.

- [ ] **Step 3: Implement helper module**

Create `src/lib/panelControls.js`:

```js
import { UI_PREFERENCES } from "../uiPreferences.js";

export const LOUDNESS_STATS_OPTIONS = [
  { id: "momentary", label: "Momentary" },
  { id: "shortTerm", label: "Short-term" },
  { id: "integrated", label: "Integrated" },
  { id: "momentaryMax", label: "Momentary Max" },
  { id: "shortTermMax", label: "Short-term Max" },
  { id: "lra", label: "Loudness Range (LRA)" },
  { id: "psr", label: "Dynamics (PSR)" },
  { id: "plr", label: "Avg. Dynamics (PLR)" },
];

export const LOUDNESS_HISTORY_LAYER_OPTIONS = [
  { id: "momentary", label: "Momentary" },
  { id: "shortTerm", label: "Short-term" },
  { id: "ref", label: "Reference" },
];

export const DEFAULT_PANEL_CONTROLS = {
  vectorscopePair: { x: 0, y: 1 },
  spectrumChannel: { type: "pair", x: 0, y: 1 },
  loudnessStatsVisibleIds: ["momentary", "shortTerm", "integrated", "lra"],
  loudnessHistoryVisibleLayerIds: ["shortTerm", "ref"],
};

const STAT_IDS = new Set(LOUDNESS_STATS_OPTIONS.map((o) => o.id));
const LAYER_IDS = new Set(LOUDNESS_HISTORY_LAYER_OPTIONS.map((o) => o.id));

function uniqueKnownIds(ids, allowed) {
  if (!Array.isArray(ids)) return null;
  const out = [];
  for (const id of ids) {
    if (allowed.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

function normalizeVectorscopePair(raw) {
  if (
    raw &&
    Number.isInteger(raw.x) &&
    Number.isInteger(raw.y) &&
    raw.x >= 0 &&
    raw.y >= 0 &&
    raw.x !== raw.y
  ) {
    return { x: raw.x, y: raw.y };
  }
  return { ...DEFAULT_PANEL_CONTROLS.vectorscopePair };
}

function normalizeSpectrumChannel(raw) {
  if (
    raw?.type === "pair" &&
    Number.isInteger(raw.x) &&
    Number.isInteger(raw.y) &&
    raw.x >= 0 &&
    raw.y >= 0 &&
    raw.x !== raw.y
  ) {
    return { type: "pair", x: raw.x, y: raw.y };
  }
  if (raw?.type === "single" && Number.isInteger(raw.ch) && raw.ch >= 0) {
    return { type: "single", ch: raw.ch };
  }
  return { ...DEFAULT_PANEL_CONTROLS.spectrumChannel };
}

export function normalizePanelControls(raw) {
  const statsIds =
    uniqueKnownIds(raw?.loudnessStatsVisibleIds, STAT_IDS) ??
    DEFAULT_PANEL_CONTROLS.loudnessStatsVisibleIds;
  const layerIds =
    uniqueKnownIds(raw?.loudnessHistoryVisibleLayerIds, LAYER_IDS) ??
    DEFAULT_PANEL_CONTROLS.loudnessHistoryVisibleLayerIds;

  return {
    vectorscopePair: normalizeVectorscopePair(raw?.vectorscopePair),
    spectrumChannel: normalizeSpectrumChannel(raw?.spectrumChannel),
    loudnessStatsVisibleIds: [...statsIds],
    loudnessHistoryVisibleLayerIds: [...layerIds],
  };
}

export function readPersistedPanelControls(prefs = UI_PREFERENCES) {
  try {
    const raw = localStorage.getItem(prefs.layoutPersistKey);
    if (!raw) return normalizePanelControls();
    const parsed = JSON.parse(raw);
    return normalizePanelControls(parsed.panelControls);
  } catch (_) {
    return normalizePanelControls();
  }
}

export function writePersistedPanelControls(panelControls, prefs = UI_PREFERENCES) {
  try {
    let prev = {};
    const raw = localStorage.getItem(prefs.layoutPersistKey);
    if (raw) prev = JSON.parse(raw);
    localStorage.setItem(
      prefs.layoutPersistKey,
      JSON.stringify({
        ...prev,
        panelControls: normalizePanelControls(panelControls),
      })
    );
  } catch (_) {}
}
```

- [ ] **Step 4: Run helper tests to verify pass**

Run: `npm test -- src/lib/panelControls.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/panelControls.js src/lib/panelControls.test.js
git commit -m "feat(frontend): add panel controls model"
```

---

## Task 2: Workspace Preset Capture

**Files:**
- Modify: `src/workspace/constants.js`
- Modify: `src/workspace/types.js`
- Modify: `src/workspace/reducer.js`
- Test: `src/workspace/reducer-tree.test.js`

- [ ] **Step 1: Add failing reducer tests**

Append these tests to the relevant `APPLY_PRESET` and `SAVE_PRESET` describe blocks in `src/workspace/reducer-tree.test.js`:

```js
it("keeps current panelControls when applying a builtin preset", () => {
  const panelControls = {
    vectorscopePair: { x: 2, y: 3 },
    spectrumChannel: { type: "single", ch: 2 },
    loudnessStatsVisibleIds: ["integrated"],
    loudnessHistoryVisibleLayerIds: ["momentary"],
  };
  const s = { ...DEFAULT_WORKSPACE_STATE, panelControls };
  const next = workspaceReducer(s, { type: "APPLY_PRESET", payload: { presetId: "lls" } });

  expect(next.panelControls).toEqual(panelControls);
});

it("restores panelControls when applying a custom preset", () => {
  const presetControls = {
    vectorscopePair: { x: 2, y: 3 },
    spectrumChannel: { type: "single", ch: 2 },
    loudnessStatsVisibleIds: ["integrated"],
    loudnessHistoryVisibleLayerIds: ["momentary"],
  };
  const s = {
    ...DEFAULT_WORKSPACE_STATE,
    customPresets: [
      {
        id: "custom-test",
        name: "Custom Test",
        builtin: false,
        tree: DEFAULT_WORKSPACE_STATE.tree,
        visibleModules: ["loudness"],
        panelControls: presetControls,
      },
    ],
  };

  const next = workspaceReducer(s, {
    type: "APPLY_PRESET",
    payload: { presetId: "custom-test" },
  });

  expect(next.panelControls).toEqual(presetControls);
});
```

Add these tests to the `SAVE_PRESET` describe block:

```js
it("saves current panelControls as part of a custom preset", () => {
  const panelControls = {
    vectorscopePair: { x: 2, y: 3 },
    spectrumChannel: { type: "single", ch: 2 },
    loudnessStatsVisibleIds: ["integrated"],
    loudnessHistoryVisibleLayerIds: ["momentary"],
  };
  const s = { ...DEFAULT_WORKSPACE_STATE, customPresets: [], panelControls };

  const next = workspaceReducer(s, { type: "SAVE_PRESET", payload: { name: "My Layout" } });

  expect(next.customPresets[0].panelControls).toEqual(panelControls);
});

it("updates panelControls without changing activePresetId", () => {
  const nextControls = {
    vectorscopePair: { x: 0, y: 1 },
    spectrumChannel: { type: "pair", x: 0, y: 1 },
    loudnessStatsVisibleIds: [],
    loudnessHistoryVisibleLayerIds: [],
  };
  const s = { ...DEFAULT_WORKSPACE_STATE, activePresetId: "lls" };

  const next = workspaceReducer(s, {
    type: "SET_PANEL_CONTROLS",
    payload: { panelControls: nextControls },
  });

  expect(next.panelControls).toEqual(nextControls);
  expect(next.activePresetId).toBe("lls");
});
```

- [ ] **Step 2: Run reducer tests to verify failure**

Run: `npm test -- src/workspace/reducer-tree.test.js`

Expected: FAIL because `panelControls` is not in workspace state and `SET_PANEL_CONTROLS` does not exist.

- [ ] **Step 3: Add workspace state support**

In `src/workspace/constants.js`, import defaults and add them to state:

```js
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
```

Update `DEFAULT_WORKSPACE_STATE`:

```js
export const DEFAULT_WORKSPACE_STATE = {
  tree: DEFAULT_TREE,
  visibleModules: [...ALL_MODULE_IDS],
  focusId: null,
  activePresetId: "default",
  fullscreenId: null,
  customPresets: [],
  panelControls: DEFAULT_PANEL_CONTROLS,
};
```

In `src/workspace/types.js`, extend typedefs:

```js
 * @typedef {{
 *   vectorscopePair: { x: number, y: number },
 *   spectrumChannel: { type: 'pair', x: number, y: number } | { type: 'single', ch: number },
 *   loudnessStatsVisibleIds: string[],
 *   loudnessHistoryVisibleLayerIds: string[],
 * }} PanelControls
```

Add `panelControls: PanelControls` to `WorkspaceState` and optional `panelControls?: PanelControls` to `Preset`.

In `src/workspace/reducer.js`, import normalization:

```js
import { normalizePanelControls } from "../lib/panelControls.js";
```

Update `APPLY_PRESET`:

```js
const isCustomPreset = !preset.builtin;
return {
  ...state,
  tree: preset.tree,
  visibleModules: preset.visibleModules,
  panelControls:
    isCustomPreset && preset.panelControls
      ? normalizePanelControls(preset.panelControls)
      : state.panelControls,
  activePresetId: presetId,
  fullscreenId: null,
};
```

Update `SAVE_PRESET`:

```js
const newPreset = {
  id,
  name,
  builtin: false,
  tree: state.tree,
  visibleModules: state.visibleModules,
  panelControls: normalizePanelControls(state.panelControls),
};
```

Add reducer case:

```js
case "SET_PANEL_CONTROLS":
  return {
    ...state,
    panelControls: normalizePanelControls(action.payload.panelControls),
  };
```

Add bound action:

```js
setPanelControls: (panelControls) =>
  dispatch({ type: "SET_PANEL_CONTROLS", payload: { panelControls } }),
```

- [ ] **Step 4: Run reducer tests to verify pass**

Run: `npm test -- src/workspace/reducer-tree.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workspace/constants.js src/workspace/types.js src/workspace/reducer.js src/workspace/reducer-tree.test.js
git commit -m "feat(frontend): capture panel controls in presets"
```

---

## Task 3: Header Controls Component

**Files:**
- Create: `src/components/PanelHeaderControls.jsx`
- Delete: `src/components/PanelChannelSelector.jsx`
- Create: `src/components/PanelHeaderControls.test.jsx`
- Delete: `src/components/PanelChannelSelector.test.jsx`

- [ ] **Step 1: Add failing component tests**

Create `src/components/PanelHeaderControls.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PanelHeaderControls } from "./PanelHeaderControls.jsx";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("PanelHeaderControls", () => {
  it("does not render channel controls below multichannel", () => {
    const { container } = render(
      <PanelHeaderControls
        activeTab="spectrum"
        channelCount={2}
        spectrumOptions={[{ key: "p-0-1", label: "L/R", sel: { type: "pair", x: 0, y: 1 } }]}
        spectrumValueKey="p-0-1"
        spectrumDisplayLabel="L/R"
        onSpectrumChange={vi.fn()}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders spectrum label for Spectrum and Spectrogram", () => {
    for (const activeTab of ["spectrum", "spectrogram"]) {
      const { unmount } = render(
        <PanelHeaderControls
          activeTab={activeTab}
          channelCount={6}
          spectrumOptions={[{ key: "s-2", label: "C", sel: { type: "single", ch: 2 } }]}
          spectrumValueKey="s-2"
          spectrumDisplayLabel="C"
          onSpectrumChange={vi.fn()}
          panelControls={DEFAULT_PANEL_CONTROLS}
          onPanelControlsChange={vi.fn()}
        />
      );

      expect(screen.getByLabelText(`${activeTab} channel`)).toBeTruthy();
      expect(screen.getByText("C")).toBeTruthy();
      unmount();
    }
  });

  it("calls vectorscope change with the selected pair", () => {
    const onVectorscopeChange = vi.fn();
    render(
      <PanelHeaderControls
        activeTab="vectorscope"
        channelCount={6}
        vectorscopeOptions={[
          { key: "0-1", label: "L/R", x: 0, y: 1 },
          { key: "0-2", label: "L/C", x: 0, y: 2 },
        ]}
        vectorscopeValueKey="0-1"
        vectorscopeDisplayLabel="L/R"
        onVectorscopeChange={onVectorscopeChange}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
      />
    );

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "L/C" }));

    expect(onVectorscopeChange).toHaveBeenCalledWith({ x: 0, y: 2 });
  });

  it("renders a Stats chip and toggles stat ids", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelHeaderControls
        activeTab="loudnessStats"
        channelCount={2}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Stats" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Momentary" }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      loudnessStatsVisibleIds: ["shortTerm", "integrated", "lra"],
    });
  });

  it("renders a Layers chip and toggles layer ids", () => {
    const onPanelControlsChange = vi.fn();
    render(
      <PanelHeaderControls
        activeTab="loudness"
        channelCount={2}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Layers" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Momentary" }));

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      loudnessHistoryVisibleLayerIds: ["shortTerm", "ref", "momentary"],
    });
  });
});
```

- [ ] **Step 2: Run component tests to verify failure**

Run: `npm test -- src/components/PanelHeaderControls.test.jsx`

Expected: FAIL because `PanelHeaderControls.jsx` does not exist.

- [ ] **Step 3: Implement `PanelHeaderControls`**

Create `src/components/PanelHeaderControls.jsx`:

```jsx
import { Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  LOUDNESS_HISTORY_LAYER_OPTIONS,
  LOUDNESS_STATS_OPTIONS,
  normalizePanelControls,
} from "../lib/panelControls.js";

function HeaderChip({ label, ariaLabel }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      className="h-6 min-w-0 max-w-[6rem] rounded-md border border-border/70 bg-transparent px-2 py-0 text-[11px] text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
    >
      {label}
    </button>
  );
}

function SelectTriggerChip({ label, ariaLabel }) {
  return (
    <SelectTrigger
      aria-label={ariaLabel}
      className="h-6 min-w-0 max-w-[6rem] rounded-md border-border/70 bg-transparent px-2 py-0 text-[11px] text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground focus:ring-0 focus:ring-offset-0"
    >
      <SelectValue>{label}</SelectValue>
    </SelectTrigger>
  );
}

function PanelSingleSelectControl({ value, label, ariaLabel, options, onSelect }) {
  const matched = options.find((opt) => opt.key === value);
  const selected = matched ?? options[0];
  if (!selected) return null;

  return (
    <Select
      value={selected.key}
      onValueChange={(key) => {
        const opt = options.find((o) => o.key === key);
        if (opt) onSelect(opt);
      }}
    >
      <SelectTriggerChip label={matched && label ? label : selected.label} ariaLabel={ariaLabel} />
      <SelectContent align="end" sideOffset={6}>
        {options.map((opt) => (
          <SelectItem key={opt.key} value={opt.key}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function toggleId(ids, id) {
  return ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id];
}

function PanelMultiSelectControl({ label, ids, options, onChange }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <HeaderChip label={label} />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-44 p-1">
        {options.map((opt) => {
          const selected = ids.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={selected}
              className={cn(
                "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted/50",
                selected ? "text-foreground" : "text-muted-foreground"
              )}
              onClick={() => onChange(toggleId(ids, opt.id))}
            >
              <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                {selected ? <Check size={10} /> : null}
              </span>
              <span className="flex-1 text-left">{opt.label}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export function PanelHeaderControls({
  activeTab,
  channelCount = 0,
  vectorscopeOptions = [],
  vectorscopeValueKey = "",
  vectorscopeDisplayLabel = "",
  onVectorscopeChange,
  spectrumOptions = [],
  spectrumValueKey = "",
  spectrumDisplayLabel = "",
  onSpectrumChange,
  panelControls,
  onPanelControlsChange,
}) {
  const controls = normalizePanelControls(panelControls);

  if (activeTab === "loudnessStats") {
    return (
      <PanelMultiSelectControl
        label="Stats"
        ids={controls.loudnessStatsVisibleIds}
        options={LOUDNESS_STATS_OPTIONS}
        onChange={(ids) =>
          onPanelControlsChange?.(
            normalizePanelControls({ ...controls, loudnessStatsVisibleIds: ids })
          )
        }
      />
    );
  }

  if (activeTab === "loudness") {
    return (
      <PanelMultiSelectControl
        label="Layers"
        ids={controls.loudnessHistoryVisibleLayerIds}
        options={LOUDNESS_HISTORY_LAYER_OPTIONS}
        onChange={(ids) =>
          onPanelControlsChange?.(
            normalizePanelControls({ ...controls, loudnessHistoryVisibleLayerIds: ids })
          )
        }
      />
    );
  }

  if (!Number.isFinite(channelCount) || channelCount <= 2) return null;

  if (activeTab === "vectorscope" && vectorscopeOptions.length > 0) {
    return (
      <PanelSingleSelectControl
        value={vectorscopeValueKey}
        label={vectorscopeDisplayLabel}
        ariaLabel="vectorscope channel"
        options={vectorscopeOptions}
        onSelect={(opt) => onVectorscopeChange?.({ x: opt.x, y: opt.y })}
      />
    );
  }

  if ((activeTab === "spectrum" || activeTab === "spectrogram") && spectrumOptions.length > 0) {
    return (
      <PanelSingleSelectControl
        value={spectrumValueKey}
        label={spectrumDisplayLabel}
        ariaLabel={`${activeTab} channel`}
        options={spectrumOptions}
        onSelect={(opt) => onSpectrumChange?.(opt.sel)}
      />
    );
  }

  return null;
}
```

- [ ] **Step 4: Delete old channel selector files**

Remove:

```bash
git rm src/components/PanelChannelSelector.jsx src/components/PanelChannelSelector.test.jsx
```

- [ ] **Step 5: Run header controls tests**

Run: `npm test -- src/components/PanelHeaderControls.test.jsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/PanelHeaderControls.jsx src/components/PanelHeaderControls.test.jsx
git rm src/components/PanelChannelSelector.jsx src/components/PanelChannelSelector.test.jsx
git commit -m "feat(frontend): unify panel header controls"
```

---

## Task 4: Wire Panel Controls Through App And LeafView

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/workspace/LeafView.jsx`
- Test: `src/components/PanelHeaderControls.test.jsx`
- Test: `src/workspace/reducer-tree.test.js`

- [ ] **Step 1: Update imports and state initialization in `App.jsx`**

Replace old persistence imports:

```js
import {
  DEFAULT_PANEL_CONTROLS,
  normalizePanelControls,
  readPersistedPanelControls,
  writePersistedPanelControls,
} from "./lib/panelControls.js";
```

Remove usage of `readPersistedVectorscopePair` and `readPersistedSpectrumChannel` from `src/preferences/layoutPersistence.js`.

Add workspace action:

```js
const { setPanelControls } = useWorkspaceStore();
```

Add state:

```js
const [panelControls, setPanelControlsState] = useState(() => readPersistedPanelControls());
const updatePanelControls = useCallback(
  (next) => {
    const normalized = normalizePanelControls(next);
    setPanelControlsState(normalized);
    setPanelControls(normalized);
  },
  [setPanelControls]
);
```

Derive channel state:

```js
const vectorscopePairUi = panelControls.vectorscopePair;
const spectrumChannelUi = panelControls.spectrumChannel;
```

Remove the old `useState` calls for `vectorscopePairUi` and `spectrumChannelUi`.

- [ ] **Step 2: Update channel change handlers**

Update `onVectorscopePairChange`:

```js
const onVectorscopePairChange = async (pair) => {
  const nextVectorscopeLabel = formatVectorscopePairLabel({
    x: pair.x,
    y: pair.y,
    channelLabels: vectorscopeChannelLabels,
  });
  intakeRef.current.setCurrentChannelMetadata({
    frequencyLabel: spectrumLiveLabel,
    vectorscopePairLabel: nextVectorscopeLabel,
  });
  if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
  updatePanelControls({ ...panelControls, vectorscopePair: pair });
  if (!isTauri()) return;
  try {
    await setVectorscopePair({ x: pair.x, y: pair.y });
  } catch (_) {}
};
```

Update `onSpectrumChannelChange`:

```js
const onSpectrumChannelChange = async (sel) => {
  const prevLabel = spectrumLiveLabel;
  const nextKey = sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
  const nextLabel = spectrumChannelOptions.find((o) => o.key === nextKey)?.label ?? prevLabel;
  intakeRef.current.setCurrentChannelMetadata({
    frequencyLabel: nextLabel,
    vectorscopePairLabel: vectorscopeLiveLabel,
  });
  if (selectedOffsetRef.current >= 0) setSelectedOffset(-1);
  updatePanelControls({ ...panelControls, spectrumChannel: sel });
  spectrumChannelRef.current = sel;
  if (running && prevLabel !== nextLabel) {
    intakeRef.current.setPendingFrequencyMarker({ from: prevLabel, to: nextLabel });
  }
  if (!isTauri()) return;
  try {
    await setSpectrumChannel(sel);
  } catch (_) {}
};
```

- [ ] **Step 3: Update clamp effects**

Replace direct channel state setters with `updatePanelControls`:

```js
useEffect(() => {
  const next = clampVectorscopePairToAvailable(
    vectorscopePairUi,
    channelCount,
    vectorscopeLabelContext
  );
  if (next.x === vectorscopePairUi.x && next.y === vectorscopePairUi.y) return;
  updatePanelControls({ ...panelControls, vectorscopePair: next });
  if (isTauri() && running) void setVectorscopePair({ x: next.x, y: next.y });
}, [
  channelCount,
  vectorscopeLabelContext,
  vectorscopePairUi.x,
  vectorscopePairUi.y,
  running,
  panelControls,
  updatePanelControls,
]);
```

```js
useEffect(() => {
  const next = clampSpectrumChannelToAvailable(spectrumChannelUi, spectrumChannelOptions);
  const curKey =
    spectrumChannelUi.type === "pair"
      ? `p-${spectrumChannelUi.x}-${spectrumChannelUi.y}`
      : `s-${spectrumChannelUi.ch}`;
  const nxtKey = next.type === "pair" ? `p-${next.x}-${next.y}` : `s-${next.ch}`;
  if (curKey === nxtKey) return;
  updatePanelControls({ ...panelControls, spectrumChannel: next });
  if (isTauri() && running) void setSpectrumChannel(next);
}, [channelCount, spectrumChannelUi, spectrumChannelOptions, running, panelControls, updatePanelControls]);
```

- [ ] **Step 4: Persist and mirror panel controls**

Add effects:

```js
useEffect(() => {
  writePersistedPanelControls(panelControls);
}, [panelControls]);

useEffect(() => {
  setPanelControls(panelControls);
}, [panelControls, setPanelControls]);
```

In the existing broad `plvs.ui` persistence effect, remove old fields:

```js
vectorscopePairX,
vectorscopePairY,
spectrumChannelType,
spectrumChannelX,
spectrumChannelY,
spectrumChannelCh,
```

Keep layout/theme/reference fields untouched.

- [ ] **Step 5: Expose panel controls through audio data**

Add to `audioData`:

```js
panelControls,
onPanelControlsChange: updatePanelControls,
loudnessStatsVisibleIds: panelControls.loudnessStatsVisibleIds,
loudnessHistoryVisibleLayerIds: panelControls.loudnessHistoryVisibleLayerIds,
```

- [ ] **Step 6: Update `LeafView.jsx`**

Replace import:

```js
import { PanelHeaderControls } from "../components/PanelHeaderControls.jsx";
```

Replace render:

```jsx
<PanelHeaderControls
  activeTab={activeTab}
  channelCount={audioData?.channelCount ?? 0}
  vectorscopeOptions={audioData?.vectorscopePairOptions ?? []}
  vectorscopeValueKey={audioData?.vectorscopeValueKey ?? ""}
  vectorscopeDisplayLabel={audioData?.vectorscopeDisplayLabel ?? ""}
  onVectorscopeChange={audioData?.onVectorscopePairChange}
  spectrumOptions={audioData?.spectrumChannelOptions ?? []}
  spectrumValueKey={audioData?.spectrumValueKey ?? ""}
  spectrumDisplayLabel={audioData?.spectrumDisplayLabel ?? ""}
  onSpectrumChange={audioData?.onSpectrumChannelChange}
  panelControls={audioData?.panelControls}
  onPanelControlsChange={audioData?.onPanelControlsChange}
/>
```

- [ ] **Step 7: Run wiring tests**

Run: `npm test -- src/components/PanelHeaderControls.test.jsx src/workspace/reducer-tree.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx src/workspace/LeafView.jsx src/components/PanelHeaderControls.test.jsx src/workspace/reducer-tree.test.js
git commit -m "feat(frontend): wire panel controls through app"
```

---

## Task 5: Stats Filtering And Empty State

**Files:**
- Modify: `src/components/panels/LoudnessStatsPanel.jsx`
- Create: `src/components/panels/LoudnessStatsPanel.test.jsx`
- Modify: `src/hooks/useLoudnessHistory.js`

- [ ] **Step 1: Add failing stats panel tests**

Create `src/components/panels/LoudnessStatsPanel.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { LoudnessStatsPanel } from "./LoudnessStatsPanel.jsx";

const primaryMetrics = [
  { id: "momentary", label: "Momentary", value: "-20.0", unit: "LUFS" },
  { id: "shortTerm", label: "Short-term", value: "-18.0", unit: "LUFS" },
  { id: "integrated", label: "Integrated", value: "-19.0", unit: "LUFS" },
  { id: "lra", label: "Loudness Range (LRA)", value: "3.0", unit: "LU" },
];

const secondaryMetrics = [
  { id: "psr", label: "Dynamics (PSR)", value: "7.0", unit: "dB" },
  { id: "plr", label: "Avg. Dynamics (PLR)", value: "8.0", unit: "dB" },
];

function renderPanel(visibleIds) {
  return render(
    <AudioDataContext.Provider
      value={{
        primaryMetrics,
        secondaryMetrics,
        loudnessStatsVisibleIds: visibleIds,
      }}
    >
      <LoudnessStatsPanel />
    </AudioDataContext.Provider>
  );
}

describe("LoudnessStatsPanel", () => {
  it("renders only visible stats", () => {
    renderPanel(["integrated", "psr"]);

    expect(screen.getByText("Integrated")).toBeTruthy();
    expect(screen.getByText("Dynamics (PSR)")).toBeTruthy();
    expect(screen.queryByText("Momentary")).toBeNull();
    expect(screen.queryByText("Short-term")).toBeNull();
  });

  it("renders an empty state when no stats are selected", () => {
    renderPanel([]);

    expect(screen.getByText("No stats selected")).toBeTruthy();
    expect(screen.queryByText("Momentary")).toBeNull();
  });

  it("does not render metric rows as buttons", () => {
    renderPanel(["momentary"]);

    expect(screen.queryByRole("button", { name: /Momentary/ })).toBeNull();
    expect(screen.getByText("Momentary")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run stats tests to verify failure**

Run: `npm test -- src/components/panels/LoudnessStatsPanel.test.jsx`

Expected: FAIL because metrics do not have ids and rows still use toggle button behavior.

- [ ] **Step 3: Add metric ids in `useLoudnessHistory.js`**

Update `primaryMetrics`:

```js
const primaryMetrics = useMemo(
  () => [
    { id: "momentary", label: "Momentary", value: fmtMetric(displayAudio.momentary), unit: "LUFS" },
    { id: "shortTerm", label: "Short-term", value: fmtMetric(displayAudio.shortTerm), unit: "LUFS" },
    { id: "integrated", label: "Integrated", value: fmtMetric(displayAudio.integrated), unit: "LUFS" },
    { id: "momentaryMax", label: "Momentary Max", value: fmtMetric(displayAudio.mMax), unit: "LUFS" },
    { id: "shortTermMax", label: "Short-term Max", value: fmtMetric(displayAudio.stMax), unit: "LUFS" },
    { id: "lra", label: "Loudness Range (LRA)", value: fmtMetric(displayAudio.lra), unit: "LU" },
  ],
  [displayAudio]
);
```

Update `secondaryMetrics`:

```js
const secondaryMetrics = useMemo(
  () => [
    { id: "psr", label: "Dynamics (PSR)", value: fmtMetric(psr), unit: "dB" },
    { id: "plr", label: "Avg. Dynamics (PLR)", value: fmtMetric(plr), unit: "dB" },
  ],
  [psr, plr]
);
```

Remove:

```js
const [histCurves, setHistCurves] = useState({ m: false, st: true });
const toggleCurve = (key) => setHistCurves((prev) => ({ ...prev, [key]: !prev[key] }));
```

Remove `histCurves` and `toggleCurve` from the returned object.

- [ ] **Step 4: Make `LoudnessStatsPanel` filter rows**

Replace `MetricRow` signature and remove button branch:

```jsx
function MetricRow({ label, value, unit }) {
  const { valueColumnCh, unitColumnRem } = UI_PREFERENCES.modules.loudness.metrics;
  const labelClass =
    "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-[length:var(--ui-fs-metric-meta)] font-medium uppercase tracking-wide leading-none text-muted-foreground";
  const valueClass = cn(
    METRIC_NUMERIC,
    "shrink-0 text-right text-[length:var(--ui-fs-metric-value)] font-semibold leading-none text-foreground"
  );
  const unitClass =
    "shrink-0 text-right text-[length:var(--ui-fs-metric-meta)] font-medium uppercase leading-none text-muted-foreground";

  return (
    <div className={METRIC_ROW_LAYOUT}>
      <span className={labelClass}>{label}</span>
      <span className={valueClass} style={{ width: `${valueColumnCh}ch` }}>
        {value}
      </span>
      <span className={unitClass} style={{ width: `${unitColumnRem}rem` }}>
        {unit}
      </span>
    </div>
  );
}
```

Update panel body:

```jsx
export function LoudnessStatsPanel({ compact = false }) {
  const { primaryMetrics, secondaryMetrics, loudnessStatsVisibleIds = [] } = useAudioData();
  const visible = [...primaryMetrics, ...secondaryMetrics].filter((metric) =>
    loudnessStatsVisibleIds.includes(metric.id)
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0">
        <div
          className={cn(
            METRICS_LIST_PAD,
            "flex min-h-0 flex-1 flex-col gap-[var(--ui-metric-list-gap)] overflow-y-auto"
          )}
        >
          {visible.length > 0 ? (
            visible.map((metric) => <MetricRow key={metric.id} {...metric} />)
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-muted-foreground">
              No stats selected
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Remove old hist curve consumers from `App.jsx` and `LoudnessPanel.jsx`**

In `App.jsx`, remove destructuring and `audioData` entries:

```js
histCurves,
toggleCurve,
```

In `LoudnessPanel.jsx`, remove destructuring:

```js
histCurves,
toggleCurve,
```

Do not remove chart curve rendering yet; Task 6 replaces it with layer props.

- [ ] **Step 6: Run stats tests**

Run: `npm test -- src/components/panels/LoudnessStatsPanel.test.jsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useLoudnessHistory.js src/components/panels/LoudnessStatsPanel.jsx src/components/panels/LoudnessStatsPanel.test.jsx src/App.jsx src/components/panels/LoudnessPanel.jsx
git commit -m "feat(frontend): filter loudness stats"
```

---

## Task 6: Loudness History Layers

**Files:**
- Modify: `src/components/panels/LoudnessPanel.jsx`
- Modify: `src/components/panels/LoudnessHistoryChart.jsx`
- Create: `src/components/panels/LoudnessHistoryChart.test.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Add failing chart tests**

Create `src/components/panels/LoudnessHistoryChart.test.jsx`:

```jsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoudnessHistoryChart } from "./LoudnessHistoryChart.jsx";

const baseProps = {
  historyYAxisTicks: [
    { v: -23, lb: "-23" },
    { v: -18, lb: "-18" },
  ],
  targetLufs: -23,
  hasHistoryData: true,
  historyChartInteractive: true,
  running: false,
  setSelectedOffset: vi.fn(),
  setStatus: vi.fn(),
  holdHistoryHud: vi.fn(),
  showHistoryHud: vi.fn(),
  onHistoryWheel: vi.fn(),
  onHistoryPointerDown: vi.fn(),
  onHistoryPointerMove: vi.fn(),
  onHistoryPointerUp: vi.fn(),
  displayHistoryPathM: "M0 0 L10 10",
  displayHistoryPathST: "M0 10 L10 0",
  selectedOffset: -1,
  showSelLine: false,
  selLineX: 0,
  isHistoryHudVisible: false,
  clampedWindowSec: 120,
  effectiveOffsetSec: 0,
  historyHover: null,
  historyTimeTicks: ["0", "60", "120"],
  historyTickSteps: 2,
  referenceLufs: -23,
  onHistoryHoverMove: vi.fn(),
  onHistoryHoverLeave: vi.fn(),
};

describe("LoudnessHistoryChart", () => {
  it("renders selected paths and reference layer", () => {
    const { container } = render(
      <LoudnessHistoryChart
        {...baseProps}
        loudnessHistoryVisibleLayerIds={["momentary", "ref"]}
      />
    );

    expect(container.querySelectorAll("path")).toHaveLength(1);
    expect(screen.getByText("Ref -23 LUFS")).toBeTruthy();
  });

  it("hides reference layer when ref is not selected", () => {
    render(
      <LoudnessHistoryChart
        {...baseProps}
        loudnessHistoryVisibleLayerIds={["shortTerm"]}
      />
    );

    expect(screen.queryByText("Ref -23 LUFS")).toBeNull();
  });

  it("shows an empty state when all layers are hidden", () => {
    render(<LoudnessHistoryChart {...baseProps} loudnessHistoryVisibleLayerIds={[]} />);

    expect(screen.getByText("No layers selected")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run chart tests to verify failure**

Run: `npm test -- src/components/panels/LoudnessHistoryChart.test.jsx`

Expected: FAIL because `loudnessHistoryVisibleLayerIds` is not implemented.

- [ ] **Step 3: Update `LoudnessPanel.jsx`**

Destructure layer ids:

```js
loudnessHistoryVisibleLayerIds,
```

Pass them to `LoudnessHistoryChart`:

```jsx
<LoudnessHistoryChart
  ...
  loudnessHistoryVisibleLayerIds={loudnessHistoryVisibleLayerIds}
/>
```

Remove the old `histCurves` prop.

- [ ] **Step 4: Update `LoudnessHistoryChart.jsx`**

Replace `histCurves` prop with:

```js
loudnessHistoryVisibleLayerIds = [],
```

Add derived flags:

```js
const showMomentary = loudnessHistoryVisibleLayerIds.includes("momentary");
const showShortTerm = loudnessHistoryVisibleLayerIds.includes("shortTerm");
const showReference = loudnessHistoryVisibleLayerIds.includes("ref");
const hasVisibleLayer = showMomentary || showShortTerm || showReference;
```

Update path rendering:

```jsx
{showMomentary && displayHistoryPathM && (
  <path
    d={displayHistoryPathM}
    fill="none"
    stroke={selectedOffset >= 0 ? "var(--ui-chart-momentary-snap)" : "var(--ui-chart-momentary)"}
    strokeWidth="var(--ui-lh-stroke-m-w)"
  />
)}
{showShortTerm && displayHistoryPathST && (
  <path
    d={displayHistoryPathST}
    fill="none"
    stroke={selectedOffset >= 0 ? "var(--ui-chart-shortterm-snap)" : "var(--ui-chart-shortterm)"}
    strokeWidth="var(--ui-lh-stroke-st-w)"
    opacity="var(--ui-lh-stroke-st-op)"
  />
)}
```

Update reference overlay:

```jsx
{showReference && Number.isFinite(referenceLufs) ? (
  <>
    {/* existing reference band, line, and label */}
  </>
) : null}
```

Add empty state inside chart area after the SVG:

```jsx
{!hasVisibleLayer ? (
  <div className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center text-xs text-muted-foreground">
    No layers selected
  </div>
) : null}
```

- [ ] **Step 5: Add audio data entry in `App.jsx`**

Ensure `audioData` includes:

```js
loudnessHistoryVisibleLayerIds: panelControls.loudnessHistoryVisibleLayerIds,
```

- [ ] **Step 6: Run chart tests**

Run: `npm test -- src/components/panels/LoudnessHistoryChart.test.jsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/panels/LoudnessPanel.jsx src/components/panels/LoudnessHistoryChart.jsx src/components/panels/LoudnessHistoryChart.test.jsx src/App.jsx
git commit -m "feat(frontend): control loudness history layers"
```

---

## Task 7: Focused Integration Cleanup

**Files:**
- Modify as needed:
  - `src/App.jsx`
  - `src/workspace/LeafView.jsx`
  - `src/components/PanelHeaderControls.jsx`
  - `src/components/panels/LoudnessPanel.jsx`
  - `src/components/panels/LoudnessStatsPanel.jsx`

- [ ] **Step 1: Search for stale names**

Run: `rg "PanelChannelSelector|histCurves|toggleCurve|vectorscopePairX|spectrumChannelType" src`

Expected: No matches for `PanelChannelSelector`, `histCurves`, or `toggleCurve`. Old channel persistence fields should not remain in `App.jsx`.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
npm test -- src/lib/panelControls.test.js src/workspace/reducer-tree.test.js src/components/PanelHeaderControls.test.jsx src/components/panels/LoudnessStatsPanel.test.jsx src/components/panels/LoudnessHistoryChart.test.jsx
```

Expected: PASS.

- [ ] **Step 3: Run related existing tests**

Run:

```bash
npm test -- src/hooks/useSnapshot.test.jsx src/lib/FrameIntake.test.js src/components/SettingsPanel.test.jsx
```

Expected: PASS.

- [ ] **Step 4: Run lints**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 5: Fix any stale imports or lint errors**

If lint reports unused imports caused by this plan, remove only those imports. Do not refactor unrelated code.

- [ ] **Step 6: Commit cleanup fixes**

If Step 5 changed files:

```bash
git add src/App.jsx src/workspace/LeafView.jsx src/components/PanelHeaderControls.jsx src/components/panels/LoudnessPanel.jsx src/components/panels/LoudnessStatsPanel.jsx
git commit -m "fix(frontend): clean up panel controls wiring"
```

If no fixes were needed, do not create an empty commit.

---

## Task 8: Final Verification

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
npm test -- src/lib/panelControls.test.js src/workspace/reducer-tree.test.js src/components/PanelHeaderControls.test.jsx src/components/panels/LoudnessStatsPanel.test.jsx src/components/panels/LoudnessHistoryChart.test.jsx
```

Expected: PASS.

- [ ] **Step 2: Run full frontend tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 4: Manual smoke test**

Run: `npm run desktop`

Expected manual checks:

- `Loudness Stats` header shows `Stats`.
- Opening `Stats` shows all stat checkboxes and does not close after one toggle.
- Default stats are Momentary, Short-term, Integrated, and Loudness Range.
- Turning all stats off shows `No stats selected`.
- `Loudness` header shows `Layers`.
- Opening `Layers` shows Momentary, Short-term, and Reference.
- Default layers are Short-term and Reference.
- Turning all layers off shows `No layers selected` while chart axes/grid remain visible.
- Momentary and Short-term stat rows are no longer clickable curve toggles.
- Spectrum and Spectrogram still share one channel selection.
- Vectorscope channel selection still changes vectorscope pair.
- Restarting the app restores current panel controls from `plvs.ui`.
- Saving a custom preset captures panel controls.
- Applying a custom preset restores panel controls.
- Applying a built-in preset changes layout but keeps current panel controls.

- [ ] **Step 5: Commit verification fixes**

If verification required fixes in files covered by this plan:

```bash
git add src/lib/panelControls.js src/workspace/constants.js src/workspace/types.js src/workspace/reducer.js src/workspace/LeafView.jsx src/App.jsx src/components/PanelHeaderControls.jsx src/components/panels/LoudnessStatsPanel.jsx src/hooks/useLoudnessHistory.js src/components/panels/LoudnessPanel.jsx src/components/panels/LoudnessHistoryChart.jsx
git commit -m "fix(frontend): polish panel display controls"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers `Stats`, `Layers`, unified `PanelHeaderControls`, persistent `panelControls`, custom preset capture/restore, built-in preset non-overwrite behavior, no old channel preference migration, all-off empty states, and existing channel behavior.
- Placeholder scan: The plan does not contain TBD/TODO placeholders. Code steps include concrete snippets and commands.
- Type consistency: The plan consistently uses `panelControls`, `vectorscopePair`, `spectrumChannel`, `loudnessStatsVisibleIds`, and `loudnessHistoryVisibleLayerIds`.
