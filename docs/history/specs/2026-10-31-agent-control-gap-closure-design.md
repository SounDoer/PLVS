# Agent Control gap closure — design

Status: approved scope (2026-10-31), implementation in progress.

## Goal

Make Agent Control cover what a user can see and operate in a running PLVS, before adding anything
that only tutorial recording needs. The audit below compared every chapter of `docs/user/` and
every toolbar control with the 113 commands on `main` (0e517ec1). Settings and panel controls were
not re-audited by hand: `settingsSurfaceCatalog.js` and `panelControlCoverage.test.js` already fail
when a control has no owner.

Tutorial recording (a synthetic pointer drawn from reported control geometry, stepping the Quick
Tour, hover tips) is a later round; see Later.

## Audit result

| Area                                                             | Today                                                           | Decision                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| Quick Tour card                                                  | Invisible to `ui inspect`; only a click dismisses it            | Event surface, closable (D1)                  |
| Toolbar menus: Sources, Loudness Profile, Panels, Views, Presets | Cannot be opened in the normal window or Dock                   | `ui show toolbar-menu` (D2)                   |
| Status Notices list                                              | Cannot be opened; conditions not inspectable                    | Sixth toolbar menu (D2), conditions (D4)      |
| Dock toolbar arrow                                               | No command; Start/Stop and Return to Normal Window already have | `ui show dock-toolbar` (D3)                   |
| Window size                                                      | View Control defers it to "a separate Window Control decision"  | `window inspect`, `window resize` (D5)        |
| Hide / show the window (tray)                                    | No command                                                      | `window hide`, `window show` (D5)             |
| Check for Updates                                                | Catalogue names an `update` owner family that does not exist    | `update inspect`, `update check` (D6)         |
| Reset Layout (Panels menu, Dock modules editor)                  | Only by composing the default document by hand                  | `workspace reset`, `dock layout reset` (D7)   |
| Click a held curve to clear Max Hold                             | No command                                                      | Not added: toggling the hold mode restarts it |

Deliberately left out and unchanged: enabling Agent Control, update policy, crash-report consent,
Reset PLVS to Default, sending Feedback, installing an update, opening external links, launching a
workbench, quitting, window position and monitor placement, hover readouts and press-and-hold
gestures.

## Decisions

### D1 Quick Tour is an event surface

The tour registers one `useUiSurface` while its card is present (`invitation` or an active step):
`kind: "quickTour"`, `origin: "event"`, `blocking: false`, target `{ phase, step }` where `phase` is
`invitation` or `tour` and `step` is 1-based (null on the invitation). Card text is not reported.
`supportedActions: ["close"]` maps to the X / Not Now intent, `close("dismissed")`, which persists
the preference through the existing `record()` path; while a preference write is in flight it is
`busy` with no actions. This follows the Update and Crash Report precedent: visible and dismissible,
never synthesized, so the onboarding design's "no capture or store shortcuts" stays true.

Unlike a dialog, the card yields to anything else that opens. The surface therefore carries an
internal `yields: true` descriptor and `ui show` does not treat it as obstructing; it is not
projected. The development fixture declaration is `{ none }`: the real first-run state (an empty
`--plvs-test-app-data-root`) shows it.

### D2 `ui show toolbar-menu`

`ui show toolbar-menu --menu <sources|loudness-profile|panels|views|presets|status>` opens one menu
through the same path as a click. Each open menu registers a navigable surface `kind: "toolbarMenu"`,
target `{ menu, presentation }` (`window` or `dock`), closed by `ui close`.

- Normal and Fullscreen: the AppHeader popovers become controlled; the request calls the existing
  `onOpenChange(true)` handler, so Sources refreshes its source list and Auto-hide Controls holds the
  header open. Opening a menu closes another, as a click does. Sources is `uiTargetNotVisible` in
  File source or when it has no sources (its button is absent or disabled); Status is
  `uiTargetNotVisible` when there are no conditions.
- Dock: the request reveals the toolbar, then opens the same editor accessory view a click opens
  (`device`, `loudness-profile`, `modules`, `views`, `presets`, `status`). The header reports each
  button's centre to the main window whenever it lays out, so the editor is anchored exactly where a
  click would anchor it.

### D3 `ui show dock-toolbar`

Reveals the Dock toolbar through the same state the arrow sets. Surface `kind: "dockToolbar"`,
target `{}`, closed through the arrow's Hide intent. While an error forces the toolbar open the
surface has no close action. Outside Dock it is `surfaceUnavailable`.

### D4 Status conditions in `ui inspect`

`ui inspect` gains `status: [{ id, kind }]`, the same ordered list the toolbar entry shows, with ids
`notice`, `audio-drop`, `channel-layout`, `update`. Texts and details stay out, as for other
surfaces. A change does not advance `uiGeneration`.

### D5 Window Control

A new `window` family for the normal-form window:

- `window inspect`: form, visible, maximized, inner size in CSS px, device pixel ratio, and the
  current monitor's work area in CSS px.
- `window resize --width --height --expected-revision`: sets the inner size in integer CSS px,
  keeping the top-left position, through the existing `applyWindowBounds` business path (clamp,
  unmaximize, DPI-safe ordering, persistence). A size larger than the work area fails with
  `windowSizeUnavailable` instead of being clamped. Refused outside the normal form.
- `window hide` / `window show`: the tray's Hide and Show intents (`requestCloseAction("tray")`,
  `onShowWindow`). In Dock they suspend and resume the strip as the tray does.

All are actions without dry-run that require the expected revision and do not advance it: window
geometry and visibility are not part of `app.inspect`.

### D6 Update Control

- `update inspect`: whether updates are enabled for this identity, check status, latest version,
  download activity and progress, ready version, and install status. Release notes are omitted.
- `update check --expected-revision`: the About page's Check for Updates (`refreshUpdateCheck`).
  Like the button, a found update may open the real Update details, which appears in `ui inspect`
  as the existing event surface. Refused with `updateUnavailable` when updates are disabled or
  managed by another workbench.

Installing stays a user action. The Settings catalogue keeps `about.checkForUpdates` owned by
`update` and moves `about.installUpdate` to `userOnly` with reason `updateInstall`.

### D7 Reset Layout

- `workspace reset --expected-revision [--dry-run]`: the Panels menu's Reset Layout
  (`resetWorkspace`), under the same guards as `workspace apply`.
- `dock layout reset --expected-revision [--dry-run]`: the Dock modules editor's Reset Layout
  (`resetDockLayout`), which restores modules, widths, controls and the default height and keeps
  edge, monitor and space reservation.

Both are ordinary mutations: they advance the revision and mark an active Preset dirty exactly as
the button does.

## Synchronization

Per `docs/agent-control/README.md`: manifest entries and wire methods (`ui.show.toolbarMenu`,
`ui.show.dockToolbar`, `window.inspect`, `window.resize`, `window.hide`, `window.show`,
`update.inspect`, `update.check`, `workspace.reset`, `dock.layout.reset`), handlers, Rust CLI
grammar, capabilities features, regenerated `generated/`, family pages (`ui.md`, new `window.md`
and `update.md`, `dock.md`, the Workspace page), the README family table, and `docs/user/cli.md`.

## Tests

Handler and component tests for each decision: surface registration and close for the tour,
menus in both forms including refusals, the Dock anchor report, the toolbar surface, status
projection, window conversions and refusals, update refusals, and both resets matching their
buttons. Contract guards (manifest coverage, generated docs, settings catalogue) cover the
synchronization. A desktop pass on Windows screenshots every menu in both forms through Agent
Control.

## Later (tutorial recording)

- `ui locate` for a closed vocabulary of controls, so the edit can draw a synthetic pointer; an ADR
  records why OS input injection was rejected.
- Quick Tour stepping (start, next, back), reopening the onboarding decision deliberately.
- First-run recipe on an isolated data root and recording notes in `docs/promo-video.md`.
- Recording Dock accessory windows; locating items inside menus.
