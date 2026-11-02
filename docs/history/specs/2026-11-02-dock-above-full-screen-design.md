# Dock above full-screen windows — design

Status: approved in discussion 2026-11-02. Windows first; macOS follows once Windows is verified.

## Goal

A user asked whether PLVS stays visible over full-screen applications and whether Dock can still
reserve space there. Today the normal window with **Always on Top** stays above borderless
full-screen windows, but the Dock strip steps behind them the way the taskbar does
(`9ae06f2ca fix(dock): yield to full-screen windows on Windows`, 2026-10-12).

Someone who parks meters in a Dock wants them resident. Dock therefore stays above full-screen
windows by default, behind a new **Above Full Screen** switch in the Dock Views menu that restores
the current step-aside behaviour when turned off. The switch is part of the Preset scene, like every
other Views option.

Reserving space for a full-screen window is not possible and stays out of scope: a full-screen
window is by definition one that covers the whole display, so it ignores the work area that
**Reserve Space** shrinks. The strip covers part of the full-screen window instead of pushing it
aside.

## Behaviour

| Dock state                     | No full-screen window | Full-screen window on the Dock's display |
| ------------------------------ | --------------------- | ---------------------------------------- |
| Above Full Screen on (default) | Topmost               | Topmost, covering an edge of that window |
| Above Full Screen off          | Topmost               | Steps behind it (current behaviour)      |

- Turning the switch while a full-screen window is present takes effect immediately in both
  directions.
- Reserve Space is independent. With it on, maximised windows still stop at the strip; full-screen
  windows are covered, never moved.
- Exclusive full-screen applications (some games) bypass desktop composition. No topmost window,
  normal or Dock, can appear over them. This is documented, not worked around.
- The Dock accessory windows (toolbar, editors) are already always on top and are unchanged.
- The normal window is unchanged on every platform.

## Decisions

### D1 Remember the full-screen state separately from the yield

`appbar.rs` currently yields directly from the `ABN_FULLSCREENAPP` notification. Shell sends that
notification only on transitions, so turning the switch off while a full-screen window is already
present would otherwise have nothing to react to.

Track Shell's last report (`FULLSCREEN_PRESENT`) and the switch (`ABOVE_FULL_SCREEN`) separately and
derive the yield as `present && !above`. Both the notification handler and the switch setter
re-apply the derived value through the existing `set_yielded` / restore-retry path. The derivation
is a pure function so it can be unit-tested without a window.

The full-screen watch registration (`watching`, ABM_NEW without ABM_SETPOS for an overlay Dock) is
kept: it is still needed for the off state and for switching at runtime.

### D2 Rust owns the stored value

`DockStateRecord` gains `above_full_screen: bool` (`aboveFullScreen` in JSON) with a serde default of
`true`, so every existing `dockState` record reads as on. Unlike `reserve_space`, it is not coerced
by platform support: macOS and Linux keep the stored value so Presets round-trip unchanged.

`enter_dock` gains `above_full_screen: Option<bool>` (omitted = stored value, else default). A new
`set_dock_above_full_screen { enabled, origin }` command changes it while docked, persists it and
applies D1. On non-Windows platforms the command persists the value without native effect until the
platform implementation lands. Feedback diagnostics record the value alongside `reserveSpace`.

### D3 Views menu switch

`DockViews.jsx` shows **Above Full Screen** below **Reserve Space**, on Windows only for now, through
a `toggle-above-full-screen` accessory action handled in `DockAccessoriesContext.jsx` and
`useDockMode.js` beside `toggle-reserve-space`. Labels follow `docs/glossary.md`.

### D4 Presets

The Preset scene's Dock section gains `aboveFullScreen`: captured in the snapshot, compared by
`presetDivergence.js`, and applied when a Preset enters or updates Dock (`PresetsContext.jsx`,
`usePresets.js`). Stored Presets without the field normalise to `true`. Where the platform cannot
apply it yet, divergence compares the stored scene value, as `reserveSpace` already does on an
unsupported platform, so a Preset never reads as modified merely because it was opened on macOS.

### D5 Portable Presets and the additive-field rule

`reserveSpace` and the other existing fields stay required and always written. New fields follow
an additive rule, written down in `docs/website-and-sharesets.md` as policy:

1. A new field is optional and is written only when it differs from its default. `formatVersion`
   does not change. Documents that do not use the feature stay byte-identical and readable by every
   earlier release.
2. The default must be the same on every platform, because an omitted field has to mean one thing.
   Once published, the default cannot change without a format version change.
3. Each such field is registered in the Sharesets feature table with its first supporting stable
   release, and each Item's minimum version is derived from the features it actually uses.
4. `formatVersion` changes only for breaking changes: renames, removals, changed meaning.

For this feature: `aboveFullScreen` joins `DOCK_ENABLED_FIELDS`, must be a boolean when present,
compiles to `true` when absent, and is exported only when `false`. Sharesets publication adds
`dockAboveFullScreen` to `optionalCapabilities` when it is `false`, matching `dockReserveSpace`.

### D6 Sharesets minimum version derived from all registered features

`scripts/sharesets-app-compatibility.mjs` hard-codes one feature (`panelOrientation`). Generalise it:
each `SHARESETS_APP_FEATURES` entry gains a detector, and `sharesetsAppRequirement` returns the
highest `minimumAppVersion` among the features a pack uses, `Requires upcoming PLVS` while any used
feature is unassigned, and the 0.20.0 base otherwise. Register
`dockAboveFullScreen: { minimumAppVersion: null, introducedAfter: "0.24.0" }`; the release-state
check already refuses to ship while it is null.
No existing Item changes requirement.

### D7 Clearer refusal of newer Presets

A Preset rejected because it contains unknown fields now reports
"This Preset requires a newer version of PLVS." instead of the generic invalid-clipboard message,
keeping the path-addressed issues. It mirrors the existing Theme wording in `packShape.js`. Releases
already shipped cannot gain this; it helps every release from this one on.

### D8 Agent Control

- `dock inspect` / `describe` report `aboveFullScreen` with platform writability.
- `dock enter --above-full-screen true|false` sets it; entering an enabled Dock with only this option
  changed updates it through the serialized transition path, as other form options do.
- On platforms without the native behaviour, supplying it fails with `controlUnavailable`, matching
  Glass on non-macOS. Preset apply keeps the stored value there without a warning.
- Update `protocol.js`, `dockControl.js`, `handlers/dock.js`, `presetScene.js`,
  `presetSnapshot.js`, `cli_control.rs`, `commandManifest.json`, `docs/agent-control/dock.md` and
  the contract tests, following the synchronization checklist in `docs/agent-control/README.md`.
  Regenerate `docs/agent-control/generated/` with `npm run docs:agent-control`.

### D9 Decision record and user documentation

- New ADR: Dock stays above full-screen windows by default. It records why the taskbar-like yield
  from 2026-10-12 is no longer the default and why reservation cannot apply to full-screen windows.
- `docs/user/workspace.md`: replace the "steps aside" paragraph with the new default, the switch,
  the exclusive full-screen limit, and the maximised-window advice for those who turn it off.
- `docs/glossary.md`: add **Above Full Screen** (全屏时置顶).
- CHANGELOG at release: Windows users upgrading will see the strip stay over full-screen windows.

## Out of scope

- macOS. Phase 2 starts with a spike: whether `FullScreenAuxiliary` plus `CanJoinAllSpaces` on the
  existing window shows it in another application's full-screen Space, or whether an `NSPanel` is
  required. Until then the switch is hidden on macOS and the value is stored only.
- Linux, which has no Dock. Normal-window behaviour there depends on the compositor and is examined
  with macOS.
- Normal window behaviour on any platform.
- Shrinking or moving full-screen windows.

## Verification

- Rust unit tests for the D1 derivation and for `DockStateRecord` defaulting a missing field to
  `true`.
- Vitest for the Views switch, the accessory action, Preset snapshot / divergence / apply, portable
  round-trip (omitted when on, written when off, absent compiles to on, wrong type rejected), the
  newer-Preset message, the generalised Sharesets requirement, and Agent Control validation and
  availability.
- Native acceptance on Windows in the dev app. The user hands over mouse and keyboard first. With a
  browser in F11 and a full-screen video on the Dock's display, take whole-screen screenshots for:
  switch on and off, Reserve Space on and off, toggling while full screen is active, top and bottom
  edges, and full screen leaving and returning. Agent Control screenshots capture only PLVS and
  cannot show stacking against another application.
- `npm run check:changes` before push.

## Risks

- Shell may report a full-screen window on another display; the existing handler already receives
  these and the derivation does not change which notifications count.
- Restoring topmost while a full-screen window is still tearing down needed retries in the original
  fix. D1 reuses that retry path rather than writing a second one.
