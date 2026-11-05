# macOS Dock Accessory Teardown and Preview Scroll Recovery

Date: 2026-11-05 (Asia/Shanghai).
Baseline source: `1d04d0f562c0e2d1766d1af84124818df7c7a24f`.

## Reproduction

An optimized packaged dev app on macOS 15.6.1 (Apple Silicon, scale 2) aborted with an uncaught
`NSRangeException` when WebKit removed its `contentLayoutRect` window observer. Three native
scenarios reproduced it: returning a Theme draft from Dock to normal form, cancelling a new clean
Profile editor with its visible Cancel button, and closing Settings then waiting through its real
60-second retirement interval. The baseline logs and screenshots remain in ignored
`artifacts/dock-settings-macos-20261105/`.

The common path was destruction of a converted `PlvsDockPanel`. WebKit registered its window
observers before `tauri-nspanel` changed the dynamic class. Main-window exit already restored the
original host before ordinary operations, but accessory destruction skipped that restoration.

## Repair

Accessory destruction now runs on AppKit's main thread, orders out and removes the accessory from
the native Dock membership set, converts it back through the plugin (also removing its registry
entry), and only then asks Tauri to destroy it. Both Settings/authoring retirement and toolbar/panel
retirement use this path. Other platforms keep their existing destruction path. No exception is
swallowed and no idle-retirement timer is disabled.

The separate Preview scroll discrepancy came from layout clamping: expanding the native Preview
host also increases the hidden editor's body height. Near the end of a long page, the browser lowers
`scrollTop` to the smaller maximum. Keeping the DOM mounted alone does not preserve that offset.
The Theme editor now captures the pre-Preview page, offset and body dimensions. On close it restores
the offset, continuing through ResizeObserver delivery until the original body dimensions return.
Visual Review jumps discard this restoration even when they stay on the same page; the explicit target owns the destination. A component regression models
both the browser clamp and the delayed native shrink, rather than relying on jsdom's unrestricted
`scrollTop` assignment.

## Repeatable Native Regression

`scripts/smoke-macos-dock-lifecycle.mjs` launches an owned packaged dev app with a fresh isolated
profile. It exercises repeated Theme/Profile/Feedback cancellation on both edges, editor transfer
through both forms, real Settings retirement/recreation and real toolbar/panel retirement/recreation.
It retains native logs and command envelopes and records executable and tracked-diff fingerprints.
This is local regression evidence; it does not manufacture clean-SHA release acceptance.

## Validation

The full repository gate passed after aligning installed packages with `npm ci`: 598 frontend test
files / 6,420 tests, formatting, lint, type checking, license/documentation/website contracts,
production build, macOS workspace/all-target Clippy with warnings denied and workspace Rust tests
(application library: 811 passed, 3 intentionally ignored). The initial gate correctly refused stale
`framer-motion` 14.7.1 against lockfile 14.9.0; no lockfile or license-policy changes were made.

Native acceptance used optimized embedded dev builds, isolated app/instance roots, stopped capture,
and the same macOS display as the baseline. The native-only candidate survived 30 cancellation
cycles. The combined fix also passed the repeatable 22-scenario native lifecycle regression,
including both real one-minute intervals. Evidence lives in ignored
`artifacts/dock-settings-macos-fix-20261105/`, including separate build and full-gate logs.

The UI acceptance in `ui-final/` additionally established:

- Default and Extra Large Settings on both Dock edges; ordinary width remained 336/400 CSS px.
  Native control changes, close/reopen, the focused Dock Settings shortcut, Saved Items export
  cancellation, and a parented native Import file dialog cancellation all worked.
- Dirty Theme and Profile documents and draft generations survived Dock/normal/Dock transfer.
  An open Theme Preview survived transfer in both directions. Save committed the exact reviewed
  Theme and Profile through their existing owners.
- Theme Palettes scrolled to the end, opened Preview and closed it: the complete Dock screenshot
  was pixel-identical. Normal-window screenshots were also pixel-identical after moving the pointer
  off the Preview button. Header, tabs, footer, dimensions and content position were preserved.
- The final packaged build also exercised Visual Review from a deeply scrolled Advanced page back
  to `interface.surface.muted` on that same page. The target stayed visible after native shrink;
  the old offset did not override the jump. Its subsequent ordinary Preview close again produced
  a pixel-identical complete screenshot.
- Dirty Theme/Profile cancellation opened the ordinary bounded, dimmed confirmation. Keep Editing
  preserved the Profile draft; Discard Changes retired the native authoring host without aborting.
- Feedback retained native-typed draft text through both forms and was cancelled without sending.
- An independent disposable AppKit window entered a real full-screen Space. Dock Settings could
  open/close; Profile accepted native keyboard input and completed Cancel/Discard. The host's native
  samples stayed `fullScreen: true`, `onActiveSpace: true`. Above Full Screen off made native Dock
  visibility false and screenshot settlement unavailable; turning it back on restored capture.
- A normal Command-Q exit and actual process restart retained Extra Large, the exact saved Theme
  document and Profile reference -18 LUFS. Reopening the saved Theme started clean. Workspace JSON
  was inspected; no Vite reload was counted as persistence evidence.
- Normal-window geometry was unchanged at 1001 x 598 CSS px across Dock transfers. The Settings
  Quick Tour button returned to normal form before starting the tour. The public quick-tour command
  itself correctly refused Dock; the Settings button was tested separately through the native UI.
- Settings closed, reopened after 20 seconds and remained open beyond 65 seconds from the original
  close. Its old timer did not destroy the active host.

The run does not certify multiple monitors/mixed DPI, live-audio load, long-duration memory drift,
or immutable release packages. It changes no audio code. Native screenshot failures while Above
Full Screen was deliberately disabled are expected visibility observations, not successful captures.
All test data and artifacts remain separate from stable PLVS.

Final lifecycle evidence is in `lifecycle-review-final/` (22 passed); the last full gate is
`check-final.log`. `ui-final/final-fingerprints.json` records the final executable and lockfile hashes
and matching stable-settings hashes. All owned test apps and the disposable full-screen host were
stopped. Acceptance ran against the working-tree changes on main before commit; no release was
performed.
