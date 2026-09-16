# Dock Modules v1.5 + v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the deferred dock modules from `docs/superpowers/specs/2026-07-11-dock-mode-design.md`: v1.5 = DockStats (user-picked readouts), DockWaveform, DockTransport (opt-in); v2 = DockSpectrogram. AppBar is NOT in this plan.

**Architecture:** Pure catalog extension — each module is one id in `dockLayout.js`, one entry in `registry.jsx`, one component. The only structural additions: DockStrip passes its `controls` object down to modules (enables DockTransport), and dock layout state grows a `statsIds` list (picked stats readouts) that rides the existing workspaceStore `dock` key and preset snapshot.

**Tech Stack:** React 19 + Tailwind v4 + Vitest (jsdom), existing dock/data infrastructure. No Rust changes.

**Conventions (every task):** LF; English comments/commits; commit subjects never start with `@`, use multiple `-m` flags; NO jest-dom (`.toBeTruthy()` / `.toBeNull()` / `.getAttribute()`); repo pre-commit hook runs prettier via lint-staged; targeted vitest per task, full `npm run check` in the final task.

**Grounded facts (verified in-repo, rely on them):**
- `metricsData.statsMetrics` (via `useMetricsData()` from `src/workspace/AudioDataContext.jsx`) is `buildStatsMetrics(displayAudio)` output: ordered array of `{ id, label, shortLabel, unit, hint, value }` where `value` is an already-formatted string (`"-"` when absent). Catalog ids/order: `STATS_CANONICAL_ORDER` in `src/lib/statsCatalog.js` (15 ids).
- History rows (`historyData.histSourceList`) carry `waveformMin` / `waveformMax`: per-channel arrays of linear sample values (source: `FrameIntake.pushHistRow`; WaveformPanel renders them via `src/math/waveformMath.js`). Rows are 100 ms apart (`HIST_SAMPLE_SEC = 0.1`).
- Spectrogram data: `historyData.getSpectrogramSnapsForKey(key)` returns a ring with `.length` and `.rowAt(i)` → `{ timestampMs, dbList, bands }`; y-mapping via `buildYToBand(bands, H, minHz, maxHz)` from `src/math/spectrogramMath.js`; colors via `buildSpectrogramLut(theme.colormap)` from `src/theme/spectrogramColormap.js` (LUT = 256×3 RGB array) with `SPECTROGRAM_DB_MIN/MAX` from `src/config/scales.js`; theme object via `getTheme(resolvedThemeId, listCustomThemes())` from `src/theme/builtinThemes.js` — copy the exact import/call shape from `src/components/panels/SpectrogramPanel.jsx:185-187`. `resolvedThemeId` is available on `useFrameData()`.
- `DOCK_SPECTRUM_KEY` (src/dock/dockAnalysisRequest.js) is the request key for BOTH spectrum paths and spectrogram snaps: `deriveAnalysisRequests` treats `spectrum` and `spectrogram` panels identically (same pushRequest), so the existing dock spectrum request feeds spectrogram snaps too. The merge activation condition in App.jsx must therefore become "docked && (modules includes spectrum OR spectrogram)" (Task 8).
- Dock preset shape today: `dock: { enabled, edge, modules }` captured in `usePresets.captureSnapshot`, applied via `applyDockPreset` in App.jsx.

---

### Task 1: Dock layout state v2 — `statsIds` + transport/stats/waveform/spectrogram ids

**Files:**
- Modify: `src/dock/dockLayout.js`
- Modify: `src/dock/dockLayout.test.js` (append)
- Modify: `src/dock/useDockLayout.js`
- Modify: `src/dock/useDockLayout.test.js` (append)

- [ ] **Step 1: Append failing tests** to `src/dock/dockLayout.test.js` — first EXTEND the file's existing top import from `./dockLayout.js` with the new names (`DOCK_MODULE_IDS`, `DEFAULT_DOCK_STATS_IDS`, `MAX_DOCK_STATS_IDS`, `normalizeDockStatsIds`, `toggleDockStatId`; note `DOCK_MODULE_IDS` is NOT currently imported there), then append:

```js

describe("dock module catalog v1.5/v2", () => {
  it("includes the new module ids after the v1 four", () => {
    expect(DOCK_MODULE_IDS).toEqual([
      "level",
      "loudness",
      "spectrum",
      "correlation",
      "stats",
      "waveform",
      "spectrogram",
      "transport",
    ]);
  });

  it("keeps the v1 default enabled set (new modules are opt-in)", () => {
    expect(DEFAULT_DOCK_MODULES).toEqual(["level", "loudness", "spectrum", "correlation"]);
  });
});

describe("normalizeDockStatsIds", () => {
  it("falls back to defaults for junk input", () => {
    expect(normalizeDockStatsIds(undefined)).toEqual(DEFAULT_DOCK_STATS_IDS);
    expect(normalizeDockStatsIds("nope")).toEqual(DEFAULT_DOCK_STATS_IDS);
  });

  it("drops unknown ids and duplicates, caps at MAX_DOCK_STATS_IDS", () => {
    const raw = ["truePeak", "ghost", "lra", "truePeak", "integrated", "psr", "plr"];
    expect(normalizeDockStatsIds(raw)).toEqual(["truePeak", "lra", "integrated", "psr"]);
  });

  it("keeps an intentionally empty list empty", () => {
    expect(normalizeDockStatsIds([])).toEqual([]);
  });
});

describe("toggleDockStatId", () => {
  it("removes a present id and appends an absent one", () => {
    expect(toggleDockStatId(["lra"], "lra")).toEqual([]);
    expect(toggleDockStatId(["lra"], "psr")).toEqual(["lra", "psr"]);
  });

  it("refuses to exceed the cap", () => {
    const full = ["integrated", "truePeak", "lra", "psr"];
    expect(toggleDockStatId(full, "plr")).toEqual(full);
  });

  it("ignores unknown ids", () => {
    expect(toggleDockStatId(["lra"], "ghost")).toEqual(["lra"]);
  });
});
```

(`DEFAULT_DOCK_MODULES` is already imported; the rest come from the import extension above.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/dock/dockLayout.test.js`
Expected: FAIL (missing exports; the catalog test fails on the shorter id list).

- [ ] **Step 3: Implement** — in `src/dock/dockLayout.js`:

Replace the two catalog constants:

```js
import { STATS_CANONICAL_ORDER } from "../lib/statsCatalog.js";

/** Known dock module ids, in catalog order (kept in sync with registry.jsx). */
export const DOCK_MODULE_IDS = [
  "level",
  "loudness",
  "spectrum",
  "correlation",
  "stats",
  "waveform",
  "spectrogram",
  "transport",
];

/** v1 default set; later-phase modules are opt-in. */
export const DEFAULT_DOCK_MODULES = ["level", "loudness", "spectrum", "correlation"];
```

Append at the end of the file:

```js
/** Spec: DockStats shows 2-4 user-picked readouts; we allow 0-4 and default to 3. */
export const MAX_DOCK_STATS_IDS = 4;

export const DEFAULT_DOCK_STATS_IDS = ["integrated", "truePeak", "lra"];

/** Normalize the persisted stats-readout selection. */
export function normalizeDockStatsIds(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_DOCK_STATS_IDS];
  const seen = new Set();
  const ids = [];
  for (const id of raw) {
    if (!STATS_CANONICAL_ORDER.includes(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_DOCK_STATS_IDS) break;
  }
  return ids;
}

export function toggleDockStatId(statsIds, id) {
  if (!STATS_CANONICAL_ORDER.includes(id)) return statsIds;
  if (statsIds.includes(id)) return statsIds.filter((s) => s !== id);
  if (statsIds.length >= MAX_DOCK_STATS_IDS) return statsIds;
  return [...statsIds, id];
}
```

- [ ] **Step 4: Run tests** — `npx vitest run src/dock/dockLayout.test.js` → PASS.

- [ ] **Step 5: Append failing hook tests** to `src/dock/useDockLayout.test.js`:

```js
  it("exposes statsIds with defaults and persists toggles", () => {
    const { result } = renderHook(() => useDockLayout());
    expect(result.current.statsIds).toEqual(["integrated", "truePeak", "lra"]);
    act(() => result.current.toggleStat("psr"));
    expect(result.current.statsIds).toEqual(["integrated", "truePeak", "lra", "psr"]);
    expect(workspaceStore.read().dock.statsIds).toEqual([
      "integrated",
      "truePeak",
      "lra",
      "psr",
    ]);
  });

  it("setStatsIds replaces the selection (used by preset apply)", () => {
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.setStatsIds(["lra"]));
    expect(result.current.statsIds).toEqual(["lra"]);
    expect(workspaceStore.read().dock.statsIds).toEqual(["lra"]);
  });

  it("stat toggles dirty the active preset", () => {
    presetsStore.patch({ list: [{ id: "p1", name: "Preset" }], activeId: "p1", dirty: false });
    const { result } = renderHook(() => useDockLayout());
    act(() => result.current.toggleStat("psr"));
    expect(presetsStore.read().dirty).toBe(true);
  });
```

- [ ] **Step 6: Implement** — `src/dock/useDockLayout.js` becomes (whole file; extends the existing pattern — the persisted `dock` value now holds `{ modules, statsIds }` and every write goes through one normalize + patch path):

```js
import { useCallback, useState } from "react";
import { presetsStore, workspaceStore } from "../persistence/index.js";
import {
  normalizeDockLayout,
  normalizeDockStatsIds,
  reorderDockModule,
  toggleDockModule,
  toggleDockStatId,
} from "./dockLayout.js";

function readDockState() {
  const raw = workspaceStore.read().dock;
  return {
    layout: normalizeDockLayout(raw),
    statsIds: normalizeDockStatsIds(raw?.statsIds),
  };
}

/**
 * Assumes a single mounted instance (App.jsx); local state is not synced via
 * workspaceStore.subscribe, so two simultaneous mounts would diverge.
 */
export function useDockLayout() {
  const [state, setState] = useState(readDockState);

  const write = useCallback((next) => {
    workspaceStore.patch({ dock: { modules: next.layout.modules, statsIds: next.statsIds } });
    // Dock layout is part of the preset snapshot, so edits dirty the active
    // preset (usePresets.apply clears the flag when it finishes).
    presetsStore.patch({ dirty: true });
    setState(next);
  }, []);

  const toggle = useCallback(
    (id) => {
      const current = readDockState();
      write({ ...current, layout: toggleDockModule(current.layout, id) });
    },
    [write]
  );
  const reorder = useCallback(
    (from, to) => {
      const current = readDockState();
      write({ ...current, layout: reorderDockModule(current.layout, from, to) });
    },
    [write]
  );
  const setModules = useCallback(
    (modules) => {
      const current = readDockState();
      write({ ...current, layout: normalizeDockLayout({ modules }) });
    },
    [write]
  );
  const toggleStat = useCallback(
    (id) => {
      const current = readDockState();
      write({ ...current, statsIds: toggleDockStatId(current.statsIds, id) });
    },
    [write]
  );
  const setStatsIds = useCallback(
    (ids) => {
      const current = readDockState();
      write({ ...current, statsIds: normalizeDockStatsIds(ids) });
    },
    [write]
  );

  return {
    modules: state.layout.modules,
    statsIds: state.statsIds,
    toggle,
    reorder,
    setModules,
    toggleStat,
    setStatsIds,
  };
}
```

Compatibility note: `normalizeDockLayout` already ignores extra keys on the raw object, and persisted v1 data (`{ modules }` without `statsIds`) normalizes to the defaults — no migration needed. Verify the existing useDockLayout tests still pass unchanged (the returned `modules`/`toggle`/`reorder`/`setModules` API is preserved).

- [ ] **Step 7: Run all dock-layout tests**

Run: `npx vitest run src/dock/dockLayout.test.js src/dock/useDockLayout.test.js`
Expected: PASS (old + new).

- [ ] **Step 8: Commit**

```bash
git add src/dock/dockLayout.js src/dock/dockLayout.test.js src/dock/useDockLayout.js src/dock/useDockLayout.test.js
git commit -m "feat(dock): extend layout state with stats selection and v1.5/v2 module ids"
```

Note: `registry.test.js` will now FAIL (registry lacks the four new ids) — that is expected and fixed by Tasks 2-6; if the pre-commit hook runs only prettier (it does), the commit still lands. Do NOT "fix" the registry test here.

---

### Task 2: DockStrip passes `controls` to modules

**Files:**
- Modify: `src/dock/DockStrip.jsx`
- Modify: `src/dock/DockStrip.test.jsx` (append)

- [ ] **Step 1: Append failing test** to `src/dock/DockStrip.test.jsx` (reuse the file's `renderStrip`/`BASE_PROPS` helpers):

```jsx
  it("passes the controls object down to modules", () => {
    // DockTransport (Task 3) renders the transport pill from controls;
    // assert via a registry module that echoes controls — use the real
    // registry: enable only "level" and spy through a stubbed registry is
    // overkill; instead assert the prop plumbing directly on the wrapper.
    renderStrip({ modules: ["level"] });
    // The module wrapper renders; plumbing is exercised in DockTransport's
    // own tests (Task 3). Here we only lock the contract that DockStrip
    // renders Component with a controls prop — via a throwaway assertion on
    // the rendered module count (regression-guard for the map change).
    expect(screen.getAllByTestId("dock-module")).toHaveLength(1);
  });
```

(Plumbing is properly asserted in Task 3's DockTransport tests; this test just guards the map refactor doesn't break rendering.)

- [ ] **Step 2: Implement** — in `src/dock/DockStrip.jsx`, change the module render line:

```jsx
              <div
                key={id}
                data-testid="dock-module"
                className={cn("min-w-0", entry.flexible ? "flex-1" : "shrink-0")}
              >
                <Component controls={controls} />
              </div>
```

(Only the `<Component />` → `<Component controls={controls} />` change; existing modules take no props and ignore it.)

- [ ] **Step 3: Run** — `npx vitest run src/dock/DockStrip.test.jsx` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/dock/DockStrip.jsx src/dock/DockStrip.test.jsx
git commit -m "feat(dock): pass controls to dock modules"
```

---

### Task 3: DockTransport module + registry entries for all four new modules

**Files:**
- Create: `src/dock/modules/DockTransport.jsx`
- Create: `src/dock/modules/DockTransport.test.jsx`
- Create stubs: `src/dock/modules/DockStats.jsx`, `src/dock/modules/DockWaveform.jsx`, `src/dock/modules/DockSpectrogram.jsx`
- Modify: `src/dock/registry.jsx`

- [ ] **Step 1: Failing test** — `src/dock/modules/DockTransport.test.jsx`:

```jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockTransport } from "./DockTransport.jsx";

const CONTROLS = {
  sourceTransportState: {
    chromeState: "ready",
    sourceLabel: "Live",
    statusLabel: "00:00",
    actionLabel: "START",
    actionKind: "start",
    primaryActionDisabled: false,
  },
  onSourceTransportAction: vi.fn(),
};

describe("DockTransport", () => {
  it("renders the locked transport pill and forwards the primary action", () => {
    render(<DockTransport controls={CONTROLS} />);
    // locked: no source popover trigger
    expect(screen.queryByRole("button", { name: /source:/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(CONTROLS.onSourceTransportAction).toHaveBeenCalledWith("start");
  });

  it("renders nothing without controls (defensive)", () => {
    const { container } = render(<DockTransport />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/dock/modules/DockTransport.test.jsx` → FAIL.

- [ ] **Step 3: Implement** — `src/dock/modules/DockTransport.jsx`:

```jsx
import { SourceTransportCluster } from "../../components/SourceTransportCluster.jsx";

/** Always-visible transport pill (opt-in module); dock is live-only. */
export function DockTransport({ controls }) {
  if (!controls?.sourceTransportState) return null;
  return (
    <div className="flex h-full items-center px-2">
      <SourceTransportCluster
        state={controls.sourceTransportState}
        sourceMode="live"
        sourceLocked
        onSourceModeChange={() => {}}
        onPrimaryAction={controls.onSourceTransportAction}
      />
    </div>
  );
}
```

Check `SourceTransportCluster`'s primary-action button accessible name: it renders `{state.actionLabel}` as button text (name "START"), and calls `onPrimaryAction(state.actionKind)` — the test above matches that contract (verify against the component before running).

Stubs (three files, adjust the exported name; DockStats shown):

```jsx
/** Placeholder replaced by its dedicated task. */
export function DockStats() {
  return <div className="h-full min-w-16" />;
}
```

- [ ] **Step 4: Registry** — `src/dock/registry.jsx` gains four entries (after `correlation`):

```jsx
import { DockSpectrogram } from "./modules/DockSpectrogram.jsx";
import { DockStats } from "./modules/DockStats.jsx";
import { DockTransport } from "./modules/DockTransport.jsx";
import { DockWaveform } from "./modules/DockWaveform.jsx";
```

```jsx
  stats: { id: "stats", label: "Stats", Component: DockStats, flexible: false },
  waveform: { id: "waveform", label: "Waveform", Component: DockWaveform, flexible: true },
  spectrogram: {
    id: "spectrogram",
    label: "Spectrogram",
    Component: DockSpectrogram,
    flexible: true,
  },
  transport: { id: "transport", label: "Transport", Component: DockTransport, flexible: false },
```

- [ ] **Step 5: Run** — `npx vitest run src/dock/` → ALL PASS (registry test heals: catalog now matches the 8 ids).

- [ ] **Step 6: Commit**

```bash
git add src/dock/
git commit -m "feat(dock): add DockTransport module and register v1.5/v2 module slots"
```

---

### Task 4: DockStats module

**Files:**
- Modify: `src/dock/modules/DockStats.jsx` (replace stub)
- Create: `src/dock/modules/DockStats.test.jsx`

- [ ] **Step 1: Failing test** — `src/dock/modules/DockStats.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricsDataProvider } from "../../workspace/AudioDataContext.jsx";
import { workspaceStore } from "../../persistence/index.js";
import { beforeEach } from "vitest";
import { DockStats } from "./DockStats.jsx";

const METRICS = [
  { id: "integrated", shortLabel: "I", unit: "LUFS", value: "-20.1" },
  { id: "truePeak", shortLabel: "TP Max", unit: "dBTP", value: "-3.2" },
  { id: "lra", shortLabel: "LRA", unit: "LU", value: "7.4" },
  { id: "psr", shortLabel: "PSR", unit: "dB", value: "11.0" },
];

function renderWith(statsMetrics) {
  return render(
    <MetricsDataProvider value={{ statsMetrics }}>
      <DockStats />
    </MetricsDataProvider>
  );
}

describe("DockStats", () => {
  beforeEach(() => {
    workspaceStore.reset();
  });

  it("renders the default selection in catalog order", () => {
    renderWith(METRICS);
    const cells = screen.getAllByTestId("dock-stat");
    expect(cells).toHaveLength(3); // integrated, truePeak, lra defaults
    expect(screen.getByText("-20.1")).toBeTruthy();
    expect(screen.getByText("TP Max")).toBeTruthy();
    expect(screen.getByText("7.4")).toBeTruthy();
    expect(screen.queryByText("11.0")).toBeNull(); // psr not selected
  });

  it("respects a persisted custom selection", () => {
    workspaceStore.patch({ dock: { modules: ["stats"], statsIds: ["psr"] } });
    renderWith(METRICS);
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(1);
    expect(screen.getByText("11.0")).toBeTruthy();
  });

  it("renders dashes for metrics missing from the feed", () => {
    workspaceStore.patch({ dock: { modules: ["stats"], statsIds: ["sideToMid"] } });
    renderWith(METRICS); // feed has no sideToMid entry
    expect(screen.getByText("-")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement** — `src/dock/modules/DockStats.jsx`:

```jsx
import { useMetricsData } from "../../workspace/AudioDataContext.jsx";
import { workspaceStore } from "../../persistence/index.js";
import { normalizeDockStatsIds } from "../dockLayout.js";
import { STATS_META } from "../../lib/statsCatalog.js";

/**
 * User-picked compact readouts from the shared stats catalog. Reads the
 * selection straight from the persisted dock state: the strip re-renders at
 * frame rate anyway (metrics context), so no dedicated subscription is
 * needed, and the picker (modules editor) writes through useDockLayout.
 */
export function DockStats() {
  const { statsMetrics } = useMetricsData() ?? {};
  const statsIds = normalizeDockStatsIds(workspaceStore.read().dock?.statsIds);
  const byId = new Map((statsMetrics ?? []).map((m) => [m.id, m]));
  return (
    <div className="flex h-full min-w-0 items-center gap-3 px-2">
      {statsIds.map((id) => {
        const metric = byId.get(id);
        const meta = STATS_META[id];
        return (
          <div key={id} data-testid="dock-stat" className="flex min-w-0 flex-col justify-center">
            <span className="truncate text-[8px] font-bold uppercase tracking-wide text-muted-foreground">
              {metric?.shortLabel ?? meta?.shortLabel ?? id}
            </span>
            <span className="font-[family-name:var(--ui-font-mono)] text-[12px] font-semibold leading-tight tabular-nums text-foreground">
              {metric?.value ?? "-"}
              {metric?.unit ? (
                <span className="ml-0.5 text-[7px] font-normal text-muted-foreground">
                  {metric.unit}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run** — `npx vitest run src/dock/modules/DockStats.test.jsx` → PASS. Then `npx vitest run src/dock/`.

- [ ] **Step 5: Commit**

```bash
git add src/dock/modules/DockStats.jsx src/dock/modules/DockStats.test.jsx
git commit -m "feat(dock): implement DockStats readout cells"
```

---

### Task 5: Stats picker row in DockModulesEditor

**Files:**
- Modify: `src/dock/editors/DockModulesEditor.jsx`
- Modify: `src/dock/editors/DockModulesEditor.test.jsx` (append)
- Modify: `src/dock/DockStrip.jsx` (pass statsIds/onToggleStat through)
- Modify: `src/App.jsx` (extend dockProps)

- [ ] **Step 1: Append failing tests** to `DockModulesEditor.test.jsx`:

```jsx
describe("stats picker row", () => {
  it("is hidden while the stats module is disabled", () => {
    render(
      <DockModulesEditor
        modules={["level"]}
        statsIds={["lra"]}
        onToggle={vi.fn()}
        onToggleStat={vi.fn()}
        onReorder={vi.fn()}
        onDone={vi.fn()}
      />
    );
    expect(screen.queryByTestId("dock-stats-picker")).toBeNull();
  });

  it("lists all catalog stats as chips and toggles them", () => {
    const onToggleStat = vi.fn();
    render(
      <DockModulesEditor
        modules={["stats"]}
        statsIds={["lra"]}
        onToggle={vi.fn()}
        onToggleStat={onToggleStat}
        onReorder={vi.fn()}
        onDone={vi.fn()}
      />
    );
    const picker = screen.getByTestId("dock-stats-picker");
    expect(picker).toBeTruthy();
    const lraChip = screen.getByRole("button", { name: /^LRA$/i });
    expect(lraChip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^PSR$/i }));
    expect(onToggleStat).toHaveBeenCalledWith("psr");
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement** — `DockModulesEditor.jsx`: add props `statsIds = []`, `onToggleStat = () => {}`; import `STATS_CANONICAL_ORDER`, `STATS_META` from `../../lib/statsCatalog.js`. The editor becomes two stacked rows when stats is enabled; the strip is 72px tall so use two ultra-compact rows (h-6 chips fit twice with the container's items-center → switch outer container to `flex-col justify-center gap-1` when the picker is visible). Replace the component body:

```jsx
export function DockModulesEditor({
  modules,
  statsIds = [],
  onToggle,
  onToggleStat,
  onReorder,
  onDone,
}) {
  const dragFromRef = useRef(null);
  const statsEnabled = modules.includes("stats");

  const moduleRow = (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        Modules
      </span>
      {DOCK_MODULE_IDS.map((id) => {
        const enabled = modules.includes(id);
        const enabledIndex = modules.indexOf(id);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={enabled}
            draggable={enabled}
            onDragStart={() => {
              dragFromRef.current = enabledIndex;
            }}
            onDragEnd={() => {
              dragFromRef.current = null;
            }}
            onDragOver={(e) => {
              if (enabled && dragFromRef.current !== null) e.preventDefault();
            }}
            onDrop={() => {
              if (enabled && dragFromRef.current !== null) {
                onReorder(dragFromRef.current, enabledIndex);
              }
              dragFromRef.current = null;
            }}
            onClick={() => onToggle(id)}
            className={cn(
              "flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition-colors",
              enabled
                ? "border-primary/50 bg-primary/15 text-foreground"
                : "border-border/60 text-muted-foreground hover:bg-muted/40"
            )}
          >
            {DOCK_MODULE_REGISTRY[id].label}
            {enabled ? <Check className="size-2.5" /> : null}
          </button>
        );
      })}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onDone}
        className="h-6 shrink-0 rounded-full bg-secondary px-2.5 text-[10px] font-semibold text-secondary-foreground hover:brightness-110"
      >
        Done
      </button>
    </div>
  );

  return (
    <div
      className={cn(
        "h-full min-w-0 px-2",
        statsEnabled ? "flex flex-col justify-center gap-1" : "flex items-center"
      )}
    >
      {statsEnabled ? (
        <>
          {moduleRow}
          <div
            data-testid="dock-stats-picker"
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
          >
            <span className="shrink-0 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
              Stats
            </span>
            {STATS_CANONICAL_ORDER.map((id) => {
              const picked = statsIds.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={picked}
                  aria-label={STATS_META[id].shortLabel}
                  onClick={() => onToggleStat(id)}
                  className={cn(
                    "h-5 shrink-0 rounded-full border px-1.5 text-[9px] font-medium transition-colors",
                    picked
                      ? "border-primary/50 bg-primary/15 text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  {STATS_META[id].shortLabel}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        moduleRow
      )}
    </div>
  );
}
```

(Keep the existing imports; the module-row JSX is the previous body with its wrapper class moved to the new outer container. Note the aria-label uses shortLabel so `getByRole("button", { name: /^LRA$/i })` resolves.)

- [ ] **Step 4: Plumb through** — `DockStrip.jsx`: accept `statsIds` and `onToggleStat` props, forward to `<DockModulesEditor modules={modules} statsIds={statsIds} onToggle={onToggleModule} onToggleStat={onToggleStat} ... />`. `App.jsx` `dockProps`: add `statsIds: dockLayout.statsIds, onToggleStat: dockLayout.toggleStat`. Also extend `presetDockState` useMemo and `applyDockPreset` — NO, preset wiring is Task 7; here only the live editing path. (DockStrip.test.jsx's BASE_PROPS may need `statsIds: []` + `onToggleStat: vi.fn()` — add them.)

- [ ] **Step 5: Run** — `npx vitest run src/dock/ src/App.smoke.test.jsx` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/dock/ src/App.jsx
git commit -m "feat(dock): add in-strip stats picker row"
```

---

### Task 6: DockWaveform module

**Files:**
- Modify: `src/dock/modules/DockWaveform.jsx` (replace stub)
- Create: `src/dock/modules/DockWaveform.test.jsx`

- [ ] **Step 1: VERIFY data shape first** (concrete check, not optional): read `src/lib/FrameIntake.js` `pushHistRow` and `src/math/waveformMath.js` — confirm history rows carry `waveformMin` / `waveformMax` as per-channel arrays of **linear** sample values in [-1, 1] (WaveformPanel's hover converts to dBFS, i.e. storage is linear). If the field names or units differ, adapt the component below and the test fixtures, and report the deviation.

- [ ] **Step 2: Failing test** — `src/dock/modules/DockWaveform.test.jsx`:

```jsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockWaveform } from "./DockWaveform.jsx";

function rows(values) {
  // Each row: symmetric min/max envelope across one stereo channel pair.
  return values.map((v) => ({
    waveformMin: [-v, -v * 0.8],
    waveformMax: [v, v * 0.8],
  }));
}

function renderWith(histSourceList) {
  return render(
    <HistoryDataProvider value={{ histSourceList }}>
      <DockWaveform />
    </HistoryDataProvider>
  );
}

describe("DockWaveform", () => {
  it("renders an envelope path whose shape follows the history", () => {
    const quiet = renderWith(rows(Array(50).fill(0.05)));
    const quietD = quiet.container.querySelector("svg path").getAttribute("d");
    quiet.unmount();
    const loud = renderWith(rows(Array.from({ length: 50 }, (_, i) => 0.05 + i * 0.015)));
    const loudD = loud.container.querySelector("svg path").getAttribute("d");
    expect(quietD).not.toBe(loudD);
    // varying envelope must produce >1 distinct Y value
    const ys = loudD
      .split(/[MLZ]/)
      .map((seg) => seg.trim().split(/\s+/)[1])
      .filter(Boolean);
    expect(new Set(ys).size).toBeGreaterThan(1);
  });

  it("renders an empty svg without history", () => {
    const { container } = renderWith([]);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("svg path")).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify failure** — FAIL (stub).

- [ ] **Step 4: Implement** — `src/dock/modules/DockWaveform.jsx`:

```jsx
import { useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";

const WINDOW_SEC = 30;
const VIEW_W = 300;
const VIEW_H = 40;

/** Max absolute envelope across channels for one row, linear [0, 1]. */
function rowEnvelope(row) {
  const mins = Array.isArray(row?.waveformMin) ? row.waveformMin : [];
  const maxs = Array.isArray(row?.waveformMax) ? row.waveformMax : [];
  let peak = 0;
  for (const v of mins) if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
  for (const v of maxs) if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
  return Math.min(1, peak);
}

/** Scrolling compact waveform: symmetric envelope of the last 30 s. */
export function DockWaveform() {
  const { histSourceList = [] } = useHistoryData() ?? {};
  const windowSamples = Math.round(WINDOW_SEC / HIST_SAMPLE_SEC);
  const rows = histSourceList.slice(-windowSamples);

  let d = "";
  if (rows.length >= 2) {
    const mid = VIEW_H / 2;
    const xOf = (i) => (i / (windowSamples - 1)) * VIEW_W;
    // Right-align: newest sample at the right edge.
    const offset = windowSamples - rows.length;
    let top = "";
    let bottom = "";
    for (let i = 0; i < rows.length; i++) {
      const env = rowEnvelope(rows[i]);
      const x = xOf(offset + i);
      const yTop = mid - env * mid;
      const yBottom = mid + env * mid;
      top += `${top ? " L" : "M"} ${x} ${yTop}`;
      bottom = ` L ${x} ${yBottom}${bottom}`;
    }
    d = `${top}${bottom} Z`;
  }

  return (
    <div className="h-full min-w-0 flex-1 px-1 py-[6px]">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
      >
        {d ? <path d={d} fill="var(--ui-waveform-trace)" opacity="0.6" /> : null}
      </svg>
    </div>
  );
}
```

(`--ui-waveform-trace` is a real token — used by WaveformPanel.jsx:74. The bottom path is built in reverse so the polygon closes cleanly.)

- [ ] **Step 5: Run** — `npx vitest run src/dock/modules/DockWaveform.test.jsx` → PASS. Sanity-check the bottom-reverse logic against the test's distinct-Y assertion.

- [ ] **Step 6: Commit**

```bash
git add src/dock/modules/DockWaveform.jsx src/dock/modules/DockWaveform.test.jsx
git commit -m "feat(dock): implement DockWaveform envelope"
```

---

### Task 7: Preset integration for statsIds

**Files:**
- Modify: `src/hooks/usePresets.js`
- Modify: `src/hooks/usePresets.test.jsx` (append)
- Modify: `src/App.jsx`

- [ ] **Step 1: Append failing test** to `usePresets.test.jsx` (reuse its dock-in-presets helpers from the v1 work):

```jsx
  it("captures and applies statsIds through the dock field", async () => {
    const applyDockPreset = vi.fn(async () => {});
    const dock = {
      enabled: true,
      edge: "top",
      modules: ["stats"],
      statsIds: ["psr", "plr"],
    };
    const { result } = renderUsePresets({ dock, applyDockPreset });
    let preset;
    await act(async () => {
      preset = await result.current.save("Stats dock");
    });
    expect(preset.dock.statsIds).toEqual(["psr", "plr"]);
    await act(async () => {
      await result.current.apply(preset.id);
    });
    expect(applyDockPreset).toHaveBeenCalledWith(
      expect.objectContaining({ statsIds: ["psr", "plr"] })
    );
  });

  it("presets without statsIds apply with an undefined statsIds (defaults downstream)", async () => {
    const applyDockPreset = vi.fn(async () => {});
    const { result } = renderUsePresets({ applyDockPreset });
    let preset;
    await act(async () => {
      preset = await result.current.save("Old dock");
    });
    const raw = presetsStore.read();
    presetsStore.patch({
      list: raw.list.map((p) => {
        const dockCopy = { ...p.dock };
        delete dockCopy.statsIds;
        return { ...p, dock: dockCopy };
      }),
    });
    await act(async () => {
      await result.current.apply(preset.id);
    });
    expect(applyDockPreset).toHaveBeenCalledWith(
      expect.objectContaining({ statsIds: undefined })
    );
  });
```

(Adapt the helper name to the file's real `renderUsePresets`-style helper, as with the v1 tests.)

- [ ] **Step 2: Implement** — `usePresets.js`:

In `captureSnapshot`'s dock field add `statsIds`:

```js
      dock: {
        enabled: dock.enabled === true,
        edge: dock.edge === "top" ? "top" : "bottom",
        modules: [...dock.modules],
        statsIds: Array.isArray(dock.statsIds) ? [...dock.statsIds] : undefined,
      },
```

In `apply`'s `presetDock` normalization add:

```js
        statsIds: Array.isArray(preset.dock?.statsIds) ? preset.dock.statsIds : undefined,
```

Default option object: `dock = { enabled: false, edge: "bottom", modules: [], statsIds: undefined }` (extend the existing default literal minimally).

In `App.jsx`:
- `presetDockState` useMemo adds `statsIds: dockLayout.statsIds` (dep array too).
- `applyDockPreset`: in the enabled branch, after `dockLayout.setModules(presetDock.modules);` add:

```js
        if (presetDock.statsIds) dockLayout.setStatsIds(presetDock.statsIds);
```

(`undefined` statsIds = legacy preset → leave current/default selection untouched; `setStatsIds` normalizes.)

- [ ] **Step 3: Run** — `npx vitest run src/hooks/usePresets.test.jsx src/App.smoke.test.jsx` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePresets.js src/hooks/usePresets.test.jsx src/App.jsx
git commit -m "feat(dock): carry stats selection through presets"
```

---

### Task 8: DockSpectrogram module (v2)

**Files:**
- Modify: `src/dock/modules/DockSpectrogram.jsx` (replace stub)
- Create: `src/dock/modules/DockSpectrogram.test.jsx`
- Modify: `src/App.jsx` (analysis-merge activation condition)
- Modify: `src/dock/dockAnalysisRequest.test.js` — no change needed to the merge itself; activation is App-side.

- [ ] **Step 1: Analysis activation** — in `App.jsx`, the `derivedAnalysisRequests` memo condition becomes:

```jsx
        docked &&
          (dockLayout.modules.includes("spectrum") ||
            dockLayout.modules.includes("spectrogram"))
```

(`deriveAnalysisRequests` treats spectrum and spectrogram panels as the same request family, so the one dock request feeds both the RTA path and the spectrogram snaps.)

- [ ] **Step 2: Failing test** — `src/dock/modules/DockSpectrogram.test.jsx`. jsdom has no real canvas 2D context (existing panels log getContext errors and tolerate them), so the component must no-op gracefully when `getContext` returns null; tests assert structure + graceful degradation, not pixels:

```jsx
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  FrameDataProvider,
  HistoryDataProvider,
} from "../../workspace/AudioDataContext.jsx";
import { DockSpectrogram } from "./DockSpectrogram.jsx";

function makeSnaps(list) {
  return {
    length: list.length,
    rowAt: (i) => list[i],
  };
}

function renderWith({ snaps }) {
  const getSpectrogramSnapsForKey = vi.fn(() => snaps);
  const utils = render(
    <FrameDataProvider value={{ resolvedThemeId: "dark" }}>
      <HistoryDataProvider value={{ getSpectrogramSnapsForKey }}>
        <DockSpectrogram />
      </HistoryDataProvider>
    </FrameDataProvider>
  );
  return { ...utils, getSpectrogramSnapsForKey };
}

describe("DockSpectrogram", () => {
  it("renders a canvas and reads snaps for the dock key", () => {
    const snap = {
      timestampMs: 1000,
      dbList: [-40, -50, -60],
      bands: [{ loHz: 20, hiHz: 200 }, { loHz: 200, hiHz: 2000 }, { loHz: 2000, hiHz: 20000 }],
    };
    const { container, getSpectrogramSnapsForKey } = renderWith({
      snaps: makeSnaps([snap]),
    });
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(getSpectrogramSnapsForKey).toHaveBeenCalled();
  });

  it("tolerates a missing snaps source (renders empty canvas)", () => {
    const { container } = renderWith({ snaps: undefined });
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
```

VERIFY the snap/band shape against `src/hooks/useSpectrogramCanvas.js` + `src/math/spectrogramMath.js` (`buildYToBand(bands, H, minHz, maxHz)` — check what `bands` entries look like, e.g. `loHz`/`hiHz` field names) and adapt the fixture + component accordingly; report any adaptation.

- [ ] **Step 3: Implement** — `src/dock/modules/DockSpectrogram.jsx`:

```jsx
import { useEffect, useRef } from "react";
import { useFrameData, useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { DOCK_SPECTRUM_KEY } from "../dockAnalysisRequest.js";
import { buildYToBand } from "../../math/spectrogramMath.js";
import { buildSpectrogramLut } from "../../theme/spectrogramColormap.js";
import { getTheme, listCustomThemes } from "../../theme/builtinThemes.js";
import { SPECTROGRAM_DB_MIN, SPECTROGRAM_DB_MAX } from "../../config/scales.js";

const WINDOW_MS = 30_000;
const W = 300;
const H = 56;
const MIN_HZ = 20;
const MAX_HZ = 20_000;

/** Scrolling compact spectrogram over the dock's shared spectrum request. */
export function DockSpectrogram() {
  const { resolvedThemeId } = useFrameData() ?? {};
  const { getSpectrogramSnapsForKey } = useHistoryData() ?? {};
  const canvasRef = useRef(null);
  const lutRef = useRef(null);
  const themeRef = useRef(null);

  // Repaint on every render: the strip re-renders at frame rate via the
  // frame context, and the canvas is tiny (300x56), matching the visual
  // history cadence closely enough without a dedicated scheduler.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom / degraded environments

    if (themeRef.current !== resolvedThemeId) {
      themeRef.current = resolvedThemeId;
      lutRef.current = buildSpectrogramLut(
        getTheme(resolvedThemeId, listCustomThemes()).colormap
      );
    }
    const lut = lutRef.current;

    ctx.clearRect(0, 0, W, H);
    const snaps = getSpectrogramSnapsForKey?.(DOCK_SPECTRUM_KEY);
    if (!snaps || snaps.length === 0) return;

    const newest = snaps.rowAt(snaps.length - 1);
    if (!newest || !Number.isFinite(newest.timestampMs)) return;
    const newestMs = newest.timestampMs;
    const oldestMs = newestMs - WINDOW_MS;

    const image = ctx.createImageData(W, H);
    const data = image.data;
    const rng = SPECTROGRAM_DB_MAX - SPECTROGRAM_DB_MIN;
    let yToBand = null;

    for (let i = snaps.length - 1; i >= 0; i--) {
      const snap = snaps.rowAt(i);
      if (!snap || !snap.dbList || !Number.isFinite(snap.timestampMs)) continue;
      if (snap.timestampMs < oldestMs) break;
      if (!yToBand) yToBand = buildYToBand(snap.bands, H, MIN_HZ, MAX_HZ);
      const x = Math.round(((snap.timestampMs - oldestMs) / WINDOW_MS) * (W - 1));
      if (x < 0 || x >= W) continue;
      for (let y = 0; y < H; y++) {
        const db = snap.dbList[yToBand[y]] ?? SPECTROGRAM_DB_MIN;
        const t = Math.max(0, Math.min(1, (db - SPECTROGRAM_DB_MIN) / rng));
        const lutIdx = Math.round(t * 255) * 3;
        const idx = (y * W + x) * 4;
        data[idx] = lut[lutIdx];
        data[idx + 1] = lut[lutIdx + 1];
        data[idx + 2] = lut[lutIdx + 2];
        data[idx + 3] = Math.round(t * 255);
      }
    }
    ctx.putImageData(image, 0, 0);
  });

  return (
    <div className="h-full min-w-0 flex-1 px-1 py-[4px]">
      <canvas ref={canvasRef} width={W} height={H} className="h-full w-full" />
    </div>
  );
}
```

Implementation notes to verify while coding (adapt + report): `buildYToBand`'s exact signature/return (array of band indices per y row — copy usage from `useSpectrogramCanvas.js:163`); `getTheme`/`listCustomThemes` exports (copy from `SpectrogramPanel.jsx:185-187`); single-column-per-snap painting is a deliberate simplification vs the panel's column-stitching (`spectrogramFrameEndMs`) — acceptable at 300px/30s (≈1.25 px per 125 ms visual frame), gaps read as intended.

- [ ] **Step 4: Run** — `npx vitest run src/dock/modules/DockSpectrogram.test.jsx` then `npx vitest run src/dock/ src/App.smoke.test.jsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/dock/modules/DockSpectrogram.jsx src/dock/modules/DockSpectrogram.test.jsx src/App.jsx
git commit -m "feat(dock): implement DockSpectrogram and widen analysis activation"
```

---

### Task 9: Full gate + docs + manual checklist

- [ ] **Step 1:** `npm run check` — everything green (frontend format/lint/test/build + versions + Rust fmt/clippy/test; Rust untouched but the gate is the gate).

- [ ] **Step 2:** Update `docs/architecture.md` §3 dock/ entry's trailing line to mention the extra modules only if the existing wording needs it (it says "modules/" generically — likely no change; do not restructure).

- [ ] **Step 3:** Update the spec's phasing table status column is NOT needed (spec is a point-in-time design record). Skip unless something contradicts.

- [ ] **Step 4: Manual verification checklist** (run `npm run tauri dev`, report results):
1. Enable Stats / Waveform / Spectrogram / Transport via the in-strip modules editor — all render live data; strip stays 72px with flexible modules sharing leftover width sensibly.
2. Stats picker: enable Stats → second chips row appears; pick/unpick readouts (cap 4); selection survives dock exit/re-enter and app restart.
3. Waveform: envelope scrolls with program audio; silence = flat line.
4. Spectrogram: colors match the workspace Spectrogram panel's theme colormap; scrolls; enabling ONLY spectrogram (no spectrum) in the dock still produces data (analysis activation widened).
5. Transport: START/STOP works from the strip without hover; source label locked to LIVE.
6. Preset round-trip: save a dock preset with custom statsIds + new modules → apply from normal mode → identical strip.
7. Theme switch while docked → spectrogram colormap follows.

- [ ] **Step 5: Commit** any doc changes:

```bash
git add -A
git commit -m "docs(dock): note v1.5/v2 module completion"
```

---

## Deferred (NOT in this plan)

AppBar reserve-space (Windows-only) — next plan; left/right edges; resizable strip height; drag-to-move; per-module width customization; spectrogram column stitching parity with the panel.
