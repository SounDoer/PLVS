# Dock Mode (miniMeters-style edge strip)

**Date:** 2026-07-11
**Status:** Design approved in discussion; implementation not started.

## Summary

Add a **Dock mode**: the PLVS window snaps to the top or bottom edge of the
current monitor as a thin, always-on-top, chromeless strip (~72 logical px
tall, full work-area width) showing a user-customizable horizontal row of
purpose-built **dock modules** (mini meters). Dock is a *window form*, not a
second app surface: the audio/data layer is untouched, and existing view
attributes (Always on Top, Hide Chrome, …) are temporarily overridden — never
overwritten — while docked.

A later Windows-only enhancement ("Reserve screen space", Win32 AppBar) makes
the strip claim real work-area space so maximized windows avoid it. Phase 1
ships without it but must not block it.

## Product decisions (locked in discussion)

| Topic | Decision |
| --- | --- |
| Edges | Top / Bottom only (horizontal strip). No left/right vertical strips. |
| Width | Full width of the monitor's **work area** (avoids taskbar / macOS Dock). Computed once on entry; no live work-area tracking in v1. |
| Height | Fixed in v1: 72 logical px initial value, defined as a `--ui-*` token (tunable at implementation time, single source). Not user-resizable. |
| Space semantics | v1: always-on-top overlay strip (form 1). AppBar reserve-space (form 2) is a **sub-option of dock**, Windows-only, later phase — not a parallel mode. |
| Content | Dedicated dock modules (approach: "watch-face widgets"), NOT squeezed workspace panels. Data layer (AudioDataContext / frame intake) fully reused; theme tokens fully reused. |
| Customization | Which modules + order, edited **inside dock mode only** (WYSIWYG). No dock pre-configuration UI in normal mode. |
| Entry point | Views popover (`FocusViewPopoverContent`): one **three-state segmented control** `Dock: Off | Top | Bottom`. Disabled while in FILE mode. |
| Exit | Hover control bar → "restore window" button. |
| FILE mode | Blocked in dock. Dock entry disabled during FILE mode; no LIVE/FILE switch inside dock (dock is live-monitoring only). |
| In-dock editing UI | **In-strip horizontal editing** (compact chip rows), no popovers — WebView content cannot render outside the 72px window, so Radix popovers are off the table inside dock. No temporary window-resize tricks. |
| Restart behavior | If the app was docked on close, restore into dock on launch (consistent with existing bounds restore). Restoring dock never auto-starts capture (PRD: no auto START). |
| Multi-monitor | Dock to the monitor the window currently occupies. If that monitor is gone on restore, fall back to primary. No drag-to-move while docked in v1 (exit → move → re-dock). |
| Settings dialog | Not reachable from dock (physically cannot fit). No Settings icon in the hover bar. |
| History interaction | None in dock. Dock modules are realtime display only (no hover-history / scrub / snapshot interactions). |
| Transition animation | None in v1 (polish later). |
| Browser dev (non-Tauri) | Dock entry hidden, same as the Glass toggle precedent. |

## Views relationship: override, not overwrite

Existing Views items are *attributes of the normal window form*. Dock is a
*form* that temporarily takes over some attribute effects at runtime without
touching stored settings:

| Views item | While docked | On exit |
| --- | --- | --- |
| Always on Top | Forced on via `setAlwaysOnTop(true)`; stored `windowPinned` untouched | Restored from stored `windowPinned` |
| Hide Chrome | Always chromeless; stored value untouched | Restored from stored value |
| Compact Panels / Auto-hide Controls | Workspace-domain; not read, not written | Unchanged |
| Opacity | **Shared**: dock strip uses the same `panelOpacity` value (translucent strip over a DAW is a core dock use case) | Shared, nothing to restore |
| Glass (mac) | Follows existing setting; no special handling | Unchanged |

Implementation caution: `useAlwaysOnTop` currently assumes stored value ==
runtime state (writes `settingsStore.windowPinned` on every change). The dock
override path must bypass that hook's persistence (call the window API
directly), so exit-restore reads a clean user value.

Because the AppHeader (and thus the Views popover) is unmounted while docked,
there is no UI surface where a user could toggle these attributes mid-dock;
the override semantics never conflict with visible controls.

## Frontend architecture

New `src/dock/` directory, sibling of `src/workspace/`:

```
src/dock/
├── registry.js        # ordered catalog of available dock modules:
│                      #   { id, label, component, defaultWidth, flexible }
├── DockStrip.jsx      # 1-D flex row container: fixed-width modules +
│                      # flexible modules (e.g. Spectrum) absorb remaining width
├── dockLayout.js      # state + persistence helpers (enabled modules, order)
├── DockControls.jsx   # hover-reveal control bar (see below)
├── editors/           # in-strip compact editors (module chips, preset chips)
└── modules/           # DockLevel, DockLoudness, DockSpectrum, DockCorrelation, …
```

- `App.jsx` gains a top-level ui-mode switch: `workspace | dock`. Dock replaces
  the entire shell (header + workspace) with `DockStrip`. `AudioDataContext` /
  frame intake must sit **above** this switch so data flow survives mode
  changes uninterrupted.
- Dock modules subscribe to the same frame/history data as panels and use the
  same instrument color tokens. No IPC changes; no Rust DSP changes.
- Adding a later-phase module = one `registry.js` entry + one component. The
  layout system needs no changes per module.

### Hover control bar (`DockControls`)

Follows the existing Auto-hide Controls overlay idiom (`SHELL_HEADER_OVERLAY`):
pointer enters strip → bar fades in as an overlay layer (translucent + blur)
above the modules; fades out ~300 ms after pointer leaves.

Left → right:

1. `SourceTransportCluster` reused as-is (28px pill fits the strip), with the
   source-mode popover **suppressed** (label becomes non-interactive; dock is
   live-only, and device picking stays a normal-mode task in v1).
2. Clear (icon button).
3. Modules (LayoutGrid icon) → switches strip into **module edit state**.
4. Presets (Bookmark icon) → switches strip into **preset state**.
5. Top/Bottom edge switch.
6. (later, Windows-only) Reserve screen space toggle.
7. Restore window (exit dock).

**Health dot (not hover-gated):** a small always-visible status dot in a strip
corner; near-invisible when healthy, colored on degradation ("no silent
failure"), details as text inside the hover bar.

### In-strip editors (no popovers inside dock)

Hard constraint: the WebView cannot draw outside the 72px window, so any
dropdown/popover taller than the strip is clipped. All in-dock editing is
horizontal and in-place — the strip content temporarily switches to an editor
row, then back:

- **Module edit state:** one horizontal row of chips, one per registry entry
  (`Level ✓ | Loudness ✓ | Spectrum ✓ | Corr ✓ | …`): click toggles enabled,
  drag reorders. Done button returns to meters.
- **Preset state:** horizontal chip list of saved presets (click = apply) +
  compact name input + Save. Row-tail actions kept minimal; full preset
  management (rename/delete) stays in normal mode.
- Source selection inside dock: LIVE only (no popover needed). Device picking
  stays a normal-mode task in v1.

These are new compact components; `ModulesPopoverContent` /
`PresetsPopoverContent` are **not** reused inside dock.

## Window behavior (shell layer)

Enter dock:

1. Persist current normal-window geometry (existing `windowBounds` flow).
2. Remove decorations, force `setAlwaysOnTop(true)` (bypassing
   `useAlwaysOnTop` persistence).
3. Compute strip rect in **physical pixels** from the current monitor's work
   area + edge (existing hard rule: physical px for set_size/set_position).
4. Lock the window size (non-resizable while docked).

Exit dock: restore saved normal bounds, decorations, and always-on-top from
stored `windowPinned`.

Persistence: a **new Rust-maintained top-level key** in `plvs-settings.json`
(sibling of `windowBounds`), e.g. `dockState: { enabled, edge, monitor }`.
`windowBounds` and its validation (`MIN_RESTORED_HEIGHT = 240` would reject
strip-sized bounds — by design) are **not modified**: dock geometry never
flows through them.

The strip rect computation is a pure function
(`MonitorRect + work area + edge → WindowBounds`) with unit tests, following
the `clamp_to_visible` precedent in `window_state.rs`. The same function must
serve both form 1 (overlay) and form 2 (AppBar) later.

## Persistence map

| Data | Store | Key domain |
| --- | --- | --- |
| Enabled dock modules + order | `workspaceStore` (`plvs:workspace`), new `dock` key | Layout domain |
| Dock window state (enabled / edge / monitor) | Rust-side `plvs-settings.json` top-level `dockState` | Shell domain |
| User's normal-form attributes (`windowPinned`, borderless, opacity…) | Unchanged, existing keys | Settings domain |

## Presets integration

`usePresets.captureSnapshot()` already snapshots the full view state (tree,
panel controls, `windowPinned`, `focusView`, `panelOpacity`, `glassEnabled`,
`windowBounds`). Extend it with:

```js
dock: { enabled, edge, modules }   // modules = ordered enabled ids
```

- Saving while docked captures a "dock preset"; applying it from normal mode
  enters dock with content in place; applying a normal preset while docked
  exits dock.
- Presets without a `dock` field (all existing ones) are treated as
  `enabled: false` — backward compatible.
- Dirty tracking / Update / Rename / Delete need no special-casing.

## Dock module catalog & phasing

| Phase | Module | Content | Notes |
| --- | --- | --- | --- |
| v1 | DockLevel | Per-channel horizontal peak bars (stereo 2 bars; 5.1/7.1 denser stack) + peak/true-peak numeric + clip accent | ~140–220px |
| v1 | DockLoudness | One primary LUFS number (M/S/I selectable) + mini history sparkline + optional reference line | ~160–240px; reuses history path math |
| v1 | DockSpectrum | Compact RTA curve, fixed scale, no axes | Flexible width (absorbs remaining space) |
| v1 | DockCorrelation | −1…+1 correlation bar + value (optional L/R balance) | ~80–120px. Vectorscope's dock form **is** the correlation bar; an XY cloud at 60px is unreadable by design decision. |
| v1.5 | DockStats | 2–4 user-picked readouts from the existing `buildStatsMetrics` catalog | Cheapest module; generalizes DockLoudness's number |
| v1.5 | DockWaveform | Scrolling compact waveform | Overlaps Level in value; visual intuition |
| v1.5 | DockTransport (optional) | `SourceTransportCluster` as an always-visible module | Near-zero cost; for users who want persistent transport |
| v2 | DockSpectrogram | Scrolling mini spectrogram (colormap LUT reuse) | Readability at 60px needs dedicated polish |
| later | AppBar reserve-space | See below | Windows only |

## Phase: AppBar (Windows-only "Reserve screen space")

Form 2 = form 1 + one attribute: the strip registers as a Win32 application
desktop toolbar (`SHAppBarMessage`), and the OS subtracts its edge from the
work area — maximized windows avoid it instead of being covered.

- UI: a "Reserve screen space" toggle inside dock's hover bar, rendered on
  Windows only (Glass precedent for platform-conditional Views controls).
- Behavior: toggle on → register appbar (ABM_NEW/ABM_SETPOS), always-on-top
  semantics become redundant; toggle off → deregister (ABM_REMOVE), back to
  form 1. Must deregister on exit-dock and on app shutdown.
- Requires handling appbar notification messages (position renegotiation,
  e.g. taskbar changes) and same-edge taskbar coexistence.
- macOS: no public API to reserve work-area space → feature is Windows-only,
  documented via the PRD Appendix A.2 platform-difference narrative (same as
  "macOS tap needs 14.2+").
- Everything else (content, modules, editing, persistence) is shared with
  form 1; the strip-rect pure function is the single geometry source for both.

Full-screen exclusive apps cover both forms (as they do the taskbar): known
platform reality, documented, not a bug.

## Failure & edge semantics

- Monitor unplugged / resolution change while docked: recompute against
  primary monitor's work area (fallback), consistent with restore behavior.
- Metering health degradation while docked: health dot changes color; details
  on hover. No silent failure.
- Non-Tauri environment: dock UI entirely hidden.

## Testing

- **Vitest:** registry catalog integrity; dock layout state (toggle / reorder /
  persistence parse + normalization, including presets without `dock` field);
  each dock module renders from fake frame data (smoke); Views segmented
  control disabled in FILE mode.
- **Rust:** unit tests for the strip-rect pure function (edges, work area,
  multi-monitor, DPI-scaled physical px), following `clamp_to_visible` tests.
- **Manual (pre-merge):** enter/exit dock geometry round-trip on a 150%-scaled
  monitor (known physical-px pitfall); restart-while-docked restore.

## Explicitly out of scope (v1)

- Left/right vertical strips; user-resizable strip height; drag-to-move while
  docked; dock content pre-configuration from normal mode; FILE mode in dock;
  history/scrub interactions in dock modules; enter/exit animation; AppBar
  implementation (design locked above, shipped later); click-through overlay
  mode.
