# Persistence Unification — Single Source of Truth via plugin-store

**Date:** 2026-06-17
**Status:** Approved
**Scope:** Storage architecture only. No new user-facing features.

## Overview

PLVS persists its UI/workspace state across five fragmented localStorage keys (plus a
separate `plugin-store` file for two fields), with inconsistent naming, ad-hoc versioning,
one double-written field, and a split backend. This spec replaces that with a single
unified persistence layer: **two logical domains**, persisted through **one backend per
environment**, with `plugin-store` as the sole source of truth in the shipped app.

## Motivation — problems being solved

1. **Fragmented + inconsistent naming.** Five keys in three styles: `plvs.ui` (dot, no
   version), `plvs:workspace:v3` (colon, versioned-in-key), `plvs:windowPinned` /
   `plvs:closeAction` (colon, flat), `plvs.captureDeviceId` (dot, legacy).
2. **`panelControls` double-write.** Written into both `plvs.ui` and `plvs:workspace:v3` —
   two write paths, a latent inconsistency source.
3. **Split backend.** `captureDeviceId` and `clearShortcut`/`clearGlobal` live in the Tauri
   `plugin-store` file (`plvs-settings.json`); everything else lives in localStorage. The
   "truth" is scattered across two stores.
4. **Ad-hoc versioning.** Only `workspace` carries a version, and it does so *in the key
   name* — bumping the format renames the key and orphans (loses) the old data.
5. **No granularity for "delete app data".** Uninstall is all-or-nothing because the real
   data hides inside the WebView's localStorage folder.
6. **Non-lean persisted set.** Some persisted content is vestigial or transient: the drag
   ratios (a dead layout engine), `focusId` (written but never rendered — removed from the
   state model entirely), and `fullscreenId` (transient view state). They should not be
   stored.

## Current-state inventory

**localStorage today**

| Key | Holds |
| --- | --- |
| `plvs.ui` | `referenceLufs`, `appearance`, `themeId`, `channelLabelOverrides`, `panelControls`, drag ratios (`mainLeft`, `leftTopRatio`, `rightTopRatio`, `loudnessHistWidthRatio`, `spectrogramTopRatio`) |
| `plvs:workspace:v3` | `tree`, `visibleModules`, `focusId`, `activePresetId`, `fullscreenId`, `panelControls`, `customPresets` |
| `plvs:windowPinned` | window always-on-top boolean |
| `plvs:closeAction` | `tray` / `quit` (removed when "ask") |
| `plvs.captureDeviceId` | legacy mirror of the plugin-store value |

**plugin-store (`plvs-settings.json`) today**

| Key | Holds |
| --- | --- |
| `captureDeviceId` | preferred capture device |
| `clearShortcut`, `clearGlobal` | Clear-shortcut combo + system-wide toggle |

**OS-managed (out of scope)**

- `autostart` — registered with the OS startup mechanism (Windows `HKCU\…\Run`, macOS
  LaunchAgent, Linux `.desktop`) via the Tauri autostart plugin. The OS is the source of
  truth; the app queries `plugin:autostart|is_enabled`. It is not application data and is
  not stored by us.

## Decisions

| Decision | Choice |
| --- | --- |
| Storage shape | Namespace partitioning — two domains |
| Domains | `settings` + `workspace` |
| API shape | Per-domain stores from a shared factory; plus top-level `exportAll`/`resetAll` |
| Production backend | `plugin-store` (`plvs-settings.json`) as the **single source of truth** |
| Dev/browser backend | `localStorage` |
| First paint | **Rust injection** — read the file before first paint, inject into the first frame |
| Window geometry | Persisted in `settings` (`windowBounds`); restored Rust-side before the window is shown, with off-screen clamping; **no second storage file** |
| Versioning | Stable keys (no `vN` suffix); internal integer `version`, baseline `0`, written **lazily**, decoupled from the app/release version |
| Persisted-set trim | Drop vestigial drag ratios + transient `fullscreenId`; **remove `focusId`** from the state model (problem #6) |
| Old-data migration | **None.** Early users reset once |

## Architecture

```
Modules  (own defaults + validation: referenceLufs normalize, panelControls normalize, …)
   │  get / patch
   ▼
settingsStore / workspaceStore     ← createDomainStore() instances
   │  read / patch / subscribe / reset / export   (+ top-level exportAll / resetAll)
   ▼
createDomainStore  (mechanics only: safe read, read-merge-write, version hook, subscribe)
   │  backend.get / set / remove
   ▼
backend adapter  (selected by environment)
   ├─ Tauri (production) → plugin-store (plvs-settings.json)   ★ single source of truth
   └─ Browser (dev)      → localStorage
```

**Layer responsibilities**

- **`createDomainStore`** — the only place that knows *how* data is stored: safe parse,
  read-merge-write (single write path so disjoint writers cannot clobber each other),
  the version hook, and the cross-context change subscription. It does not know which
  fields a domain contains; it moves whole JSON blobs.
- **Domain stores** (`settingsStore`, `workspaceStore`) — thin instances of the factory,
  one per namespace.
- **Modules** — own *what* the data means: defaults, validation, semantics
  (`normalizeReferenceLufs`, `normalizePanelControls`, theme resolution, …). Unchanged in
  spirit from today's `uiStore` split of "mechanics vs. semantics".

This generalizes today's `src/preferences/uiStore.js` (which already owns the mechanics for
the single `plvs.ui` key) from "manages one key" to "manages all domains".

## Domains and field assignment

**`settings`** — global preferences, independent of layout, always exactly one copy:

- `referenceLufs`, `appearance`, `themeId`, `channelLabelOverrides`
- `closeAction`, `windowPinned`
- `captureDeviceId`, `clearShortcut`, `clearGlobal`
- `windowBounds`: `{ x, y, width, height, isMaximized }` (window size/position; `isMaximized`
  records the flag rather than the maximized-out dimensions)

**`workspace`** — layout/workspace state (everything that follows the workspace/preset):

- `tree`, `visibleModules`, `activePresetId`
- `panelControls`
- `customPresets`

**`panelControls` double-write (problem #2):** its single home is `workspace`. The live
value lives at `workspace.panelControls`; a preset is a **snapshot** of it stored in
`customPresets`. One source of truth, read/write through one path.

**Preset shape.** A saved preset (`SAVE_PRESET`) is a snapshot of the **restorable-view
subset** of the `workspace` domain — `{ tree, visibleModules, panelControls }` (plus
`id` / `name` / `builtin` metadata). `tree` carries the split `sizes`, so a preset also
restores panel proportions. It deliberately omits the two bookkeeping fields
(`activePresetId` — the pointer to the active preset; `customPresets` — the preset list
itself) and the transient `fullscreenId`. Concisely: **preset = `workspace` −
`{ activePresetId, customPresets }`**, minus transient view state. Applying a preset writes
those three fields back and resets `fullscreenId` to `null`. This relationship stays
self-consistent after the persisted-set trim, so `SAVE_PRESET` needs no change.

### Not persisted — runtime-only or vestigial (problem #6: lean the persisted set)

An audit of the existing persisted content found three items to trim — two dropped from
persistence (still runtime state), and one (`focusId`) removed from the state model
altogether. Trimming them also reverses the earlier "drag ratios move into `workspace`"
idea — they simply disappear.

- **Drag ratios** `mainLeft` / `leftTopRatio` / `rightTopRatio` / `loudnessHistWidthRatio` /
  `spectrogramTopRatio` — **vestigial**. The ratio-based layout (`PanelSet` +
  `useLayoutDrag`) was superseded by the tree-based `SplitLayout`, which carries its own
  split sizes in `tree.sizes` and has its own splitter drag. `PanelSet` is never rendered
  and the `useLayoutDrag` handlers are computed in `App.jsx` but never attached to anything.
  These fields persist dead state → **not persisted**. Removing the dead `PanelSet` /
  `useLayoutDrag` / `App.jsx` wiring is a separate code-cleanup task.
- **`focusId`** — written by the reducer but **never read for rendering** (`SplitLayout`
  does not reference it); it is a write-only by-product of `SET_FOCUS`, whose only useful
  effect is activating the target module's tab. → **removed entirely** from the workspace
  state model: drop it from `DEFAULT_WORKSPACE_STATE` and the `WorkspaceState` type, have
  `SET_FOCUS` keep only its tab-activation effect, and remove the `focusId`-clearing branch
  in `TOGGLE_MODULE_VISIBLE`. (Stronger than "not persisted" — the field ceases to exist.)
- **`fullscreenId`** — live single-module fullscreen view state (used by `SplitLayout`,
  toggled by `F`, cleared by `Esc`), but **transient view state**. Persisting it would
  reopen the app inside a single-module fullscreen. → **not persisted**; resets to `null`
  on launch so a restart opens the normal multi-panel view.

`loudnessStatsVisibleIds` + `loudnessStatsOrder` were reviewed and kept as-is: "full order +
visible subset" is clearer as two arrays than a merged list.

## `createDomainStore` API

```js
// persistence/createDomainStore.js — the single copy of all storage mechanics
function createDomainStore({ name, backend }) {
  return {
    read(),            // backend.get(name) → safe-parse → migrate(version ?? 1) → object, or {} on absent/corrupt
    patch(partial),    // read-merge-write through backend.set(name, merged)
    subscribe(fn),     // cross-context change notification, filtered to this domain
    reset(),           // backend.remove(name)
    export(),          // return read()
  };
}
```

```js
// persistence/index.js — the single "manager" entry point
export const settingsStore  = createDomainStore({ name: "plvs:settings" });
export const workspaceStore = createDomainStore({ name: "plvs:workspace" });

const ALL = [settingsStore, workspaceStore];
export const exportAll = () => ALL.map((s) => s.export());   // problem #5
export const resetAll  = () => ALL.forEach((s) => s.reset()); // problem #5
```

Module usage keeps defaults/validation on the module side:

```js
const referenceLufs = normalizeReferenceLufs(settingsStore.read().referenceLufs);
settingsStore.patch({ referenceLufs: -23 });
```

## Backend adapter

A small seam so `createDomainStore` never calls a concrete store directly:

```
backend.get(name) / backend.set(name, value) / backend.remove(name)

  ├─ localStorageBackend  (dev)        — synchronous
  └─ pluginStoreBackend   (production) — backed by plvs-settings.json
```

In production the adapter maps each domain name to a top-level entry in
`plvs-settings.json`. localStorage is **not used in production** — it disappears from the
shipped app entirely, so the source of truth is exactly one file the app owns
(`%APPDATA%/com.soundoer.plvs/plvs-settings.json` and OS equivalents). This makes the
"delete application data" question precise: there is one file to delete or keep.

## First paint — Rust injection (no flash)

`plugin-store` reads are asynchronous (file IO across the Rust boundary), so a naive switch
would paint defaults first and reconcile a frame later — visibly flashing the entire layout
(`tree`, drag ratios) and theme. Because nearly the whole persisted state feeds the first
frame, the fix operates at the store/backend level, once, for all fields:

- On startup, the Tauri (Rust) setup reads `plvs-settings.json` **before** the WebView
  paints and injects it into the first frame via `window.__PLVS_INITIAL_STATE__`.
- The frontend reads the injected blob **synchronously** for the first render; the domain
  stores take over after mount.
- Launch-cost impact is negligible: a few-KB JSON read is single-digit milliseconds,
  dwarfed by WebView/JS startup.

**Window geometry restore (same read).** The window is created hidden; the same Rust read
applies `settings.windowBounds` (size, position, or `isMaximized`) before the window is
shown, so there is no resize/reposition jump and no second storage file. Before applying,
the saved rectangle is checked against the currently available monitors
(`available_monitors`); if it would land mostly off-screen (e.g. a monitor was unplugged),
it is clamped/re-centered onto a visible monitor. Saving is event-driven: window
`moved`/`resized` are debounced, then the current outer position/size + maximized flag are
written to `settings.windowBounds`.

## Versioning — stable keys, lazy integer `version`

- Keys are permanently stable, with **no `vN` suffix**: `plvs:settings`, `plvs:workspace`.
- Version is a **monotonic integer** that means "storage-format generation", **decoupled
  from the app/release version**. It increments only when the persisted shape changes, so
  it advances far slower than the app version.
- It lives **inside** the blob as a `version` field, following the convention
  **"absent = 0"** (the baseline). `createDomainStore.read()` resolves `blob.version ?? 0`
  and runs an (initially empty) migration chain.
- The field is written **lazily**: nothing writes `version` today. The first time a future
  release makes a breaking format change, it adds a `0 → 1` migration and only then does
  `save` start writing `version: 1`. "No field = baseline 0, field present = 1+" stays
  unambiguous.

The read convention and the (empty) migration hook ship now so future migrations are an
additive one-liner; the stored field does not.

## Migration — none

Early users reset once. The old localStorage keys (`plvs.ui`, `plvs:workspace:v3`,
`plvs:windowPinned`, `plvs:closeAction`, `plvs.captureDeviceId`) and the old flat
plugin-store keys (`captureDeviceId`, `clearShortcut`, `clearGlobal`) are **not** carried
forward — the new `settings`/`workspace` domains start from defaults. Justification: PLVS is
pre-1.0 (v0.3.5) with a small user base, and dropping the migration removes an entire
read-old-keys-and-translate module (and its tests).

**One-shot cleanup (trivial, not a migration module):** on first run of the new version,
best-effort `remove` the orphaned old keys above from whichever backend is active, so the
store file / localStorage stays tidy. This is a few lines, not a translation layer.

## Resolution summary

| Problem | Resolution |
| --- | --- |
| #1 Inconsistent naming | Two domains; physical keys owned by the adapter |
| #2 `panelControls` double-write | Single home in `workspace`; presets snapshot it |
| #3 Split backend | Hidden behind the adapter; production is plugin-store only |
| #4 Ad-hoc versioning | Stable keys + internal lazy `version` + migration hook in one place |
| #5 No delete granularity | Truth is a single owned file; `exportAll`/`resetAll` available |
| #6 Non-lean persisted set | Drop vestigial drag ratios; remove `focusId`; `fullscreenId` runtime-only |

## Out of scope

- `autostart` — OS-managed, not application data.
- Other than window geometry (the one new persisted capability added here), no change to
  *what* settings exist or *how* modules validate them — only *where/how* they persist.
- Loudness-awareness, channel-label phase 2, and other feature work.

## Testing notes

- `createDomainStore`: safe parse of corrupt/absent blobs → `{}`; read-merge-write does not
  clobber sibling fields; `reset`/`export`; `version ?? 1` resolution with an empty chain.
- Backend adapters: localStorage and plugin-store implementations satisfy the same
  `get`/`set`/`remove` contract.
- Field assignment: `settings` vs. `workspace` round-trip; `panelControls` has a single
  persisted home; presets snapshot `panelControls` without a second write path.
- Persisted-set trim: a persisted `workspace` blob never contains drag ratios or
  `fullscreenId`; `fullscreenId` is `null` on launch regardless of prior state. `focusId`
  no longer exists in `WorkspaceState`; `SET_FOCUS` still activates the target tab.
- First-paint injection: frontend reads `window.__PLVS_INITIAL_STATE__` synchronously when
  present and falls back to backend read when absent.
- Window geometry: saved bounds round-trip through `settings.windowBounds`; off-screen
  clamping re-centers a rectangle whose monitor is gone onto a visible monitor;
  `isMaximized` restores to maximized rather than to the maximized-out dimensions.
- One-shot cleanup removes the listed orphan keys and is idempotent.
