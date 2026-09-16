# Panel Rename: Level Meter + Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove the legacy `peak` / `loudnessStats` naming now that the panels are "Level Meter" and "Stats" — rename module ids, panelControls keys, constants, files, and components — and add a one-time "reset once" guard so persisted workspaces/presets referencing the old ids reset gracefully instead of crashing.

**Architecture:** Rename in dependency order so each task leaves the suite green and keeps the risky `peak` token unambiguous: panelControls keys/constants first (removes the `loudnessStats*` field strings), then file/component renames, then the `loudnessStats`→`stats` module id, then the `peak`→`levelMeter` module id, then the reset-once guard. Persistence uses the project's "no migration / reset once" philosophy (see `src/persistence/cleanupLegacyKeys.js`): we do NOT remap old data; we detect unknown module ids on load and fall back to defaults.

**Tech Stack:** React 19, Vitest + Testing Library, Vite, JS (JSDoc types).

**Scope decision (from discussion):** Full rename INCLUDING persisted module ids + panelControls keys, with a reset-once guard. No data migration.

---

## Naming map

| Old | New | Persisted? |
|-----|-----|-----------|
| module id `peak` | `levelMeter` | yes (tree tabs, panelsById/panelOrder/panelControlsById keys, presets) |
| module id `loudnessStats` | `stats` | yes (same) |
| panelControls `loudnessStatsVisibleIds` | `statsVisibleIds` | yes (inside panelControls objects) |
| panelControls `loudnessStatsOrder` | `statsOrder` | yes |
| const `LOUDNESS_STATS_META/ORDER/OPTIONS` | `STATS_META/ORDER/OPTIONS` (already exist in statsCatalog) | no |
| const `LOUDNESS_STATS_IDS` (panelControls.js local) | `STATS_IDS` | no |
| file `PeakPanel.jsx` / export `PeakPanel` | `LevelMeterPanel.jsx` / `LevelMeterPanel` | no |
| file `LoudnessStatsPanel.jsx` / export `LoudnessStatsPanel` | `StatsPanel.jsx` / `StatsPanel` | no |

**MUST NOT rename (these are NOT the module id):**
- `levelMeterMode` and its value `"peak"` (the Peak display mode) — keep as-is.
- `LEVEL_METER_MODE_OPTIONS` entry `{ id: "peak", label: "Peak" }` — keep.
- DSP / data fields: `peakDb`, `peakHoldDb`, `samplePeak`, `truePeak*`, `tpMax`, peak math/tests — keep.
- The `loudness` module (LoudnessPanel) and `useLoudnessHistory` hook name — out of scope, keep.

---

## Task 1: Rename panelControls stat keys + constants

Renames the persisted panelControls field names and the exported constants. After this task, the string `loudnessStats` survives ONLY as the module id (unblocks Task 3's unambiguous rename).

**Files:**
- Modify: `src/lib/panelControls.js`
- Modify: `src/lib/panelControls.test.js`
- Modify: `src/components/PanelHeaderControls.jsx` (key usages + constant imports only — NOT the `activeTab === "loudnessStats"` string)
- Modify: `src/components/panels/LoudnessStatsPanel.jsx` (reads `panelControls.loudnessStats*`)
- Modify: `src/components/panels/LoudnessStatsPanel.test.jsx`
- Modify: `src/components/PanelHeaderControls.test.jsx` (panelControls keys + `LOUDNESS_STATS_ORDER` import)
- Modify: `src/App.jsx` (`normalizedPanelControls.loudnessStatsVisibleIds` at ~:461-462)
- Modify: `src/workspace/types.js` (the two key names in the PanelControls typedef)
- Modify: `src/workspace/reducer-tree.test.js` (`loudnessStatsVisibleIds`/`loudnessStatsOrder` + `LOUDNESS_STATS_ORDER` import)

- [ ] **Step 1: Update tests to the new names (red)**

In every test file above, rename: `loudnessStatsVisibleIds`→`statsVisibleIds`, `loudnessStatsOrder`→`statsOrder`, and the imported/used constant `LOUDNESS_STATS_ORDER`→`STATS_CANONICAL_ORDER` (import it from `@/lib/statsCatalog.js`) / `LOUDNESS_STATS_OPTIONS`→`STATS_OPTIONS`. Do NOT touch the module-id string `"loudnessStats"` (tab/activeTab/panelControlsById key) in these tests yet.

- [ ] **Step 2: Run the suites to confirm they fail**

Run: `npx vitest run src/lib/panelControls.test.js src/components/panels/LoudnessStatsPanel.test.jsx src/components/PanelHeaderControls.test.jsx src/workspace/reducer-tree.test.js`
Expected: FAIL (source still emits old key names).

- [ ] **Step 3: Rename in source**

- `src/lib/panelControls.js`: delete the `LOUDNESS_STATS_META/ORDER/OPTIONS` re-export aliases (lines ~3-5); update imports so consumers use `STATS_*` directly (it already imports from `./statsCatalog.js`). Rename local `LOUDNESS_STATS_IDS`→`STATS_IDS`. In `DEFAULT_PANEL_CONTROLS` rename `loudnessStatsVisibleIds`→`statsVisibleIds`, `loudnessStatsOrder`→`statsOrder` (value `[...STATS_CANONICAL_ORDER]`). In `normalizePanelControls` rename the two output keys and their `raw?.` reads accordingly (`raw?.statsVisibleIds`, `raw?.statsOrder`), using `STATS_IDS` and `STATS_CANONICAL_ORDER`.
- `src/components/PanelHeaderControls.jsx`: change imports `LOUDNESS_STATS_OPTIONS`→`STATS_OPTIONS`, `LOUDNESS_STATS_ORDER`→`STATS_CANONICAL_ORDER` (from `@/lib/statsCatalog.js`; keep `DEFAULT_PANEL_CONTROLS` from panelControls.js). In the `activeTab === "loudnessStats"` block rename `loudnessStatsOrder`→`statsOrder`, `loudnessStatsVisibleIds`→`statsVisibleIds`, `options={STATS_OPTIONS}`, `[...STATS_CANONICAL_ORDER]`, `DEFAULT_PANEL_CONTROLS.statsVisibleIds`. Leave the `activeTab === "loudnessStats"` string unchanged (Task 3).
- `src/components/panels/LoudnessStatsPanel.jsx`: rename the two `panelControls?.loudnessStats*` reads to `statsVisibleIds`/`statsOrder`.
- `src/App.jsx`: `normalizedPanelControls.loudnessStatsVisibleIds`→`.statsVisibleIds` (both occurrences ~:461-462).
- `src/workspace/types.js`: rename the two key names in the typedef.

- [ ] **Step 4: Run the suites (green)**

Run: `npx vitest run src/lib src/components src/workspace src/App.toolbar.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(stats): rename loudnessStats* panelControls keys and constants to stats*"
```

---

## Task 2: Rename panel component files + exports

Internal-only (no persisted impact). `PeakPanel`→`LevelMeterPanel`, `LoudnessStatsPanel`→`StatsPanel`.

**Files:**
- Rename: `src/components/panels/PeakPanel.jsx` → `LevelMeterPanel.jsx`; `src/components/panels/PeakPanel.test.jsx` → `LevelMeterPanel.test.jsx`
- Rename: `src/components/panels/LoudnessStatsPanel.jsx` → `StatsPanel.jsx`; `src/components/panels/LoudnessStatsPanel.test.jsx` → `StatsPanel.test.jsx`
- Modify: `src/workspace/registry.jsx` (imports + `Component:` refs)

- [ ] **Step 1: git mv the files**

```bash
git mv src/components/panels/PeakPanel.jsx src/components/panels/LevelMeterPanel.jsx
git mv src/components/panels/PeakPanel.test.jsx src/components/panels/LevelMeterPanel.test.jsx
git mv src/components/panels/LoudnessStatsPanel.jsx src/components/panels/StatsPanel.jsx
git mv src/components/panels/LoudnessStatsPanel.test.jsx src/components/panels/StatsPanel.test.jsx
```

- [ ] **Step 2: Rename the exported component symbols and their references**

- In `LevelMeterPanel.jsx`: rename `export function PeakPanel`→`export function LevelMeterPanel` (and any internal self-reference / displayName).
- In `LevelMeterPanel.test.jsx`: update the import and all `PeakPanel` usages → `LevelMeterPanel`; update the import path to `./LevelMeterPanel.jsx`.
- In `StatsPanel.jsx`: rename `export function LoudnessStatsPanel`→`export function StatsPanel`.
- In `StatsPanel.test.jsx`: update import (`./StatsPanel.jsx`) and all `LoudnessStatsPanel` usages → `StatsPanel`.
- In `src/workspace/registry.jsx`: change `import { PeakPanel } from "../components/panels/PeakPanel"`→`import { LevelMeterPanel } from "../components/panels/LevelMeterPanel"`; same for `LoudnessStatsPanel`→`StatsPanel` from `../components/panels/StatsPanel`. Update `Component: PeakPanel`→`Component: LevelMeterPanel` and `Component: LoudnessStatsPanel`→`Component: StatsPanel`. (Leave registry keys/ids `peak`/`loudnessStats` for Tasks 3-4.)

- [ ] **Step 3: Grep for leftover references**

Run: `git grep -nE "PeakPanel|LoudnessStatsPanel" -- src/`
Expected: no matches.

- [ ] **Step 4: Run suites (green)**

Run: `npx vitest run src/components/panels src/workspace`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(panels): rename PeakPanel->LevelMeterPanel, LoudnessStatsPanel->StatsPanel"
```

---

## Task 3: Rename module id `loudnessStats` → `stats`

After Task 1, `loudnessStats` survives only as the module id, so this is an unambiguous token rename.

**Files (source):**
- `src/workspace/registry.jsx` (key `loudnessStats:` and `id: "loudnessStats"`)
- `src/workspace/constants.js` (`ALL_MODULE_IDS` entry; `DEFAULT_TREE` leaf `tabs: ["loudnessStats"]`/`activeTab`)
- `src/workspace/types.js` (`ModuleId` union member)
- `src/components/PanelHeaderControls.jsx` (`activeTab === "loudnessStats"` → `"stats"`)

**Files (tests asserting the id):**
- `src/workspace/constants.test.js`, `src/components/PanelHeaderControls.test.jsx`, and any test that uses `"loudnessStats"` as a tab/activeTab/panelControlsById key or asserts registry/default-state for it. Find them all.

- [ ] **Step 1: Find every occurrence**

Run: `git grep -nE "loudnessStats" -- src/`
Every remaining hit is the module id (Task 1 removed the key strings). Note each site.

- [ ] **Step 2: Update tests first (red), then source**

Replace the token `loudnessStats`→`stats` at every site from Step 1 (both source and tests). In tests this includes leaf `tabs: ["loudnessStats"]`/`activeTab: "loudnessStats"`, `panelControlsById.loudnessStats`, and any `MODULE_REGISTRY.loudnessStats` / `DEFAULT_PANELS_BY_ID.loudnessStats` assertions.

- [ ] **Step 3: Run suites**

Run: `npx vitest run src/workspace src/components`
Expected: PASS. Then `git grep -nE "loudnessStats" -- src/` → expect zero matches.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(stats): rename module id loudnessStats -> stats"
```

---

## Task 4: Rename module id `peak` → `levelMeter`

The risky one: `peak` is overloaded. Rename ONLY the module-id token. Use the protect-list below.

**PROTECT (do NOT change):**
- `levelMeterMode: "peak"` and any `levelMeterMode` value.
- `LEVEL_METER_MODE_OPTIONS` entry `{ id: "peak", label: "Peak" }` and the `["peak", "momentary", "shortTerm"]` mode-id assertion in `panelControls.test.js`.
- `peakDb`, `peakHoldDb`, `samplePeak*`, `truePeak*`, `tpMax`, `peakHold`, and any DSP/peak-math identifiers.
- `snapshotResolve.test.js` `{ correlation: 0.9, peak: -1 }` (a data field, not a module id).
- `spectrumPeakHold`, `peakPath` (spectrum), etc.

**RENAME `peak`→`levelMeter` ONLY where it is the module id:**
- Source: `src/workspace/registry.jsx` (key `peak:` + `id: "peak"`); `src/workspace/constants.js` (`ALL_MODULE_IDS` first entry + `DEFAULT_TREE` leaf `tabs: ["peak"]`/`activeTab: "peak"` + the comment); `src/workspace/types.js` (`ModuleId` member); `src/components/PanelHeaderControls.jsx` (`activeTab === "peak"` → `"levelMeter"`).
- Tests asserting the id specifically: `src/workspace/constants.test.js` (`DEFAULT_PANELS_BY_ID.peak`→`.levelMeter`, `DEFAULT_WORKSPACE_STATE.panelControlsById.peak`→`.levelMeter`, `MODULE_REGISTRY.peak.id`→`.levelMeter`), `src/components/PanelHeaderControls.test.jsx` (`activeTab="peak"`).
- Tests where `"peak"` is used as a representative module id for tree/panel mechanics (`reducer-tree.test.js`, `treeUtils.test.js`, `reducer.test.js`, `WorkspaceContext.test.jsx`, `panelControlInstances.test.js`, `persistence/index.test.js` `visibleModules: ["peak"]`): replace the module-id token `"peak"`/`'peak'`→`"levelMeter"` for consistency, applying the PROTECT list above (do NOT touch `levelMeterMode: "peak"` lines).

- [ ] **Step 1: Enumerate occurrences and classify**

Run: `git grep -nE "\bpeak\b|\"peak\"|'peak'|PeakPanel|Peak" -- src/`
For each hit, classify as module-id (rename) vs protected (keep) using the lists above.

- [ ] **Step 2: Apply the rename (source + tests)**

Edit each module-id site `peak`→`levelMeter`. Leave every protected site untouched.

- [ ] **Step 3: Verify with grep + suite**

Run: `git grep -nE "\"peak\"|'peak'" -- src/` and confirm every REMAINING `"peak"` is a protected use (a `levelMeterMode` value, a `LEVEL_METER_MODE_OPTIONS` id, or a peak data field) — there must be NO surviving module-id `"peak"`.
Run: `npx vitest run src/workspace src/components src/lib src/persistence`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(level-meter): rename module id peak -> levelMeter"
```

---

## Task 5: Reset-once guard for unknown module ids

So a persisted workspace or preset that still references `peak`/`loudnessStats` (or any unknown id) resets gracefully instead of rendering an undefined panel.

**Files:**
- Modify: `src/workspace/panelInstances.js` (add `hasKnownModulesOnly` helper + export)
- Create: `src/workspace/panelInstances.test.js` additions OR a focused test (colocate)
- Modify: `src/workspace/WorkspaceContext.jsx` (`initState` guard)
- Modify: `src/hooks/usePresets.js` (`normalizePresets` filters presets with unknown module ids)
- Modify/extend: `src/workspace/WorkspaceContext.test.jsx`, `src/hooks/usePresets.test.jsx`

- [ ] **Step 1: Write the failing helper test**

Add a test (colocated, e.g. `src/workspace/panelInstances.test.js`) asserting:

```js
import { hasKnownModulesOnly } from "./panelInstances.js";

// known: all panelsById moduleIds are in the registry
expect(hasKnownModulesOnly({ panelsById: { stats: { id: "stats", moduleId: "stats" } } })).toBe(true);
// unknown: a legacy/renamed id
expect(hasKnownModulesOnly({ panelsById: { loudnessStats: { id: "loudnessStats", moduleId: "loudnessStats" } } })).toBe(false);
// empty/missing panelsById is treated as known (nothing invalid)
expect(hasKnownModulesOnly({ panelsById: {} })).toBe(true);
expect(hasKnownModulesOnly({})).toBe(true);
```

- [ ] **Step 2: Run it (red)**

Run: `npx vitest run src/workspace/panelInstances.test.js`
Expected: FAIL — `hasKnownModulesOnly` not exported.

- [ ] **Step 3: Implement the helper**

In `src/workspace/panelInstances.js`:

```js
export function hasKnownModulesOnly(stateLike) {
  const panelsById = stateLike?.panelsById;
  if (!panelsById || typeof panelsById !== "object") return true;
  return Object.values(panelsById).every((panel) => Boolean(MODULE_REGISTRY[panel?.moduleId]));
}
```

- [ ] **Step 4: Run it (green)**

Run: `npx vitest run src/workspace/panelInstances.test.js`
Expected: PASS.

- [ ] **Step 5: Wire into initState (test first)**

In `src/workspace/WorkspaceContext.test.jsx` add a test: when the persisted workspace contains a panel with an unknown moduleId (e.g. `loudnessStats`), the provider initializes to `DEFAULT_WORKSPACE_STATE` (e.g. its tree/panelsById match the default). Then update `initState` in `src/workspace/WorkspaceContext.jsx`:

```js
function initState() {
  const parsed = workspaceStore.read();
  if (!parsed.tree || !parsed.panelsById || !Array.isArray(parsed.panelOrder)) {
    return DEFAULT_WORKSPACE_STATE;
  }
  if (!hasKnownModulesOnly(parsed)) {
    return DEFAULT_WORKSPACE_STATE; // reset-once: drop pre-rename / unknown-module layouts
  }
  return {
    ...DEFAULT_WORKSPACE_STATE,
    ...parsed,
    panelControlsById: normalizePanelControlsById(parsed.panelsById, parsed.panelControlsById),
    fullscreenId: null,
  };
}
```

(Add the `hasKnownModulesOnly` import.)

- [ ] **Step 6: Filter presets with unknown ids (test first)**

In `src/hooks/usePresets.test.jsx` add a test: a persisted preset whose `panelsById` contains an unknown moduleId is dropped from the normalized list. Then update `normalizePresets` in `src/hooks/usePresets.js`:

```js
function normalizePresets(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_PRESETS;
  const list = (Array.isArray(raw.list) ? raw.list : []).filter(hasKnownModulesOnly);
  return {
    list,
    activeId: typeof raw.activeId === "string" ? raw.activeId : null,
  };
}
```

(Import `hasKnownModulesOnly` from `../workspace/panelInstances.js`. A preset object has the same `{ tree, panelsById, ... }` shape, so the helper applies directly.)

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run src/workspace src/hooks/usePresets.test.jsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(workspace): reset to defaults when persisted module ids are unknown"
```

---

## Task 6: Full verification

- [ ] **Step 1: Grep for stray legacy names**

Run: `git grep -nE "loudnessStats|LoudnessStatsPanel|PeakPanel|loudnessStatsVisibleIds|loudnessStatsOrder|LOUDNESS_STATS" -- src/`
Expected: no matches.

Run: `git grep -nE "\"peak\"|'peak'" -- src/` and eyeball: every hit must be a protected use (`levelMeterMode: "peak"`, a `LEVEL_METER_MODE_OPTIONS` id, or peak data). No module-id `"peak"` survives.

- [ ] **Step 2: Run the full project check**

Run: `npm run check`
Expected: PASS (version + format + lint + test + build + Rust). The 4 pre-existing lint warnings in `useSettings.js`/`useThemeEditor.js` are unrelated and acceptable.

- [ ] **Step 3: Commit any formatter-only changes**

```bash
git add -A
git commit -m "chore(rename): apply formatter after panel rename"
```

---

## Notes for the implementer

- This is "reset once": existing users' saved workspace layout and any presets that referenced `peak`/`loudnessStats` will reset to defaults on first launch after this change. That is the accepted behavior — do NOT add data migration.
- The Rust backend is untouched; `peak` / `loudness` DSP names there are unrelated.
- Docs/specs under `docs/` may still reference old ids historically — out of scope; do not edit docs.
