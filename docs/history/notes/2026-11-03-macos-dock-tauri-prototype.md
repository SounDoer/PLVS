# macOS Dock: Tauri Panel integration probe

> Historical experiment. The superseded prototype scripts have been archived under ignored
> `artifacts/macos-dock-plugin-integration/retired-prototypes/`. The final integration uses the
> crates.io plugin; see the dated plugin integration note for current validation evidence.

Date: 2026-11-03. Follow-up to the native-only probe of the same date. This records an
experiment, not shipped behavior or a decision to vendor Tao.

## Implementation boundary

The installed Tauri 2.12.2 / Tao 0.37.1 source has no public NSPanel constructor option.
`prepare-tao.py` copies the pinned registry package into a temporary directory and makes Tao
allocate its own window subclass with NSPanel as its superclass. Tao's own ivars, delegate,
WKWebView and Tauri window identity remain in place. No live object's class is changed and no
WebView is detached from its owning Tauri window.

The dedicated Cargo runner applies a temporary `paths` override. `Cargo.toml`, `Cargo.lock`
and the registry source remain unchanged. This prototype makes **all** its Tao windows Panels,
with the nonactivating mask set at construction and preserved across decoration changes.
That shortcut is intentional experimental scope, not the proposed production architecture.

Repository hooks are compiled only for macOS dev-identity builds and take effect only with
`PLVS_MACOS_PANEL_PROTOTYPE=1`. They configure Space membership on Dock entry/exit and avoid
Tao's explicit application activation when focusing Dock accessories. Other identities do not
compile these hooks. The normal dev launcher does not apply the temporary dependency override.
The experiment adds no public Agent Control method or macOS Above Full Screen UI switch.

## Reproduction

1. Run the normal development prerequisites once (`npm run desktop:dev`) to obtain sidecars,
   the dev CLI and the pinned Cargo package, then stop that session.
2. Run `bash scripts/prototypes/macos-dock/run-tauri.sh`. This prepares the override and runs
   the actual dev app. The no-watch option prevents native rebuilds during the investigation.
3. For CUA to locate the executable as an app, stop that session, run
   `python3 scripts/prototypes/macos-dock/stage-app.py`, and serve the frontend with
   `TAURI_ENV_PLATFORM=darwin TAURI_DEBUG=true npm run dev`. Launch the emitted temporary
   `PLVS Panel Probe.app`. The bundle carries the opt-in environment variable.
4. Use `npm run desktop:control -- capabilities --json`, then inspect and retain the revision.
   Enter Dock with `dock enter --edge bottom --reserve-space false --expected-revision <n> --json`.
   Keep reservation off so this investigation does not move external application windows.
5. Use the independent native probe host in native full screen. Open the actual Dock toolbar,
   Views and Presets. Type a name without saving it; clear it before closing. Read `inspect`
   after each mutation rather than replaying a revision.

The separately served Vite process must receive `TAURI_ENV_PLATFORM`. An initial staging attempt
omitted it and rendered the browser-mode application inside the native window. Dock entry then
returned `commitNotObserved`. That attempt is excluded from passing results; it was corrected by
fully restarting the app and frontend server, not by treating a Vite reload as persistence evidence.

Native telemetry is in `$TMPDIR/plvs-tauri-panel-probe.jsonl`. The experimental bundle is only a
local automation aid, not a supported PLVS package or a distributable Preview. It emitted generic
`unknown path` startup rejections, so packaging/startup health is not an acceptance result here.

## Verified in the actual PLVS application

Environment: Apple Silicon, macOS 26.3, one display. No audio capture was started.

- Actual main-window IPC, capabilities and state inspection work with the Tao-owned Panel.
- Dock main, header and editor each report NSPanel ancestry and active-Space membership while
  the independent full-screen host remains the foreground bundle.
- Clicking Show Toolbar and Views opens the real accessory WebViews without activating PLVS.
- The actual Presets input accepts `Panel probe draft` while the host remains foreground.
  The draft was cleared; no Preset was created.
- Clicking Hide Axes & Labels updates the real business state and global revision from 1 to 2.
  Clicking again restores the original value, revision 3. No direct store mutation was used.
- Escape closes the editor and then the toolbar through the existing frontend behavior.
- Agent Control captures main and accessory PNGs while they are over full screen.
- Three entry/exit cycles (top, bottom, bottom) restore the normal 1163 x 790 CSS-pixel size.
- A full process exit was verified with no remaining app process, followed by relaunch. The app
  boots into the persisted 157-point bottom Dock and can open its toolbar over full screen again.

The first before/after normal-window screenshot pair was pixel-identical at 2326 x 1580.
A later pair after focus experiments differs by 3156 pixels, all within the horizontal divider's
two image rows (y=789..790). Do not call that later pair pixel-identical; pointer/focus state must
be normalized before final visual acceptance. Neither screenshot comparison proves OS activation
or Space restoration.

## Normal-window follow-up and outside-click repair

The initial automated normal-window activation check was inconclusive. The React UI,
dimensions, window level and saved collection behavior restore correctly. However, after leaving
Dock over full screen, native samples can still show the host as foreground and both windows
on the active Space. The restored main is still a nonactivating Panel in this experiment.

Both Tao's explicit focus/activation path and a follow-up using modern `NSApplication.activate`
were exercised. The latter did not reliably change the foreground identity under CUA input.
The normal-mode mouse event path also attempts application activation. Application-targeted
automation may not supply the same activation context as ordinary user input; this distinction
requires a real mouse check before assigning the cause. The user subsequently performed that
check and reported that returning to normal mode works correctly. Count this as a successful
manual result on this machine, rather than treating the CUA activation result as a product failure.

The same manual check confirmed a real defect: clicking the host's black background did not close
the toolbar. The integration probe had not wired a macOS global mouse observer to the existing
`dock-interaction-elsewhere` event. A nonactivating Panel cannot rely on blur alone.

The repair installs global and local mouse monitors plus an application-activation observer while
the header or editor is visible. Clicks within the observed Dock window group are preserved;
outside interactions emit the existing event so React owns dismissal through its business functions.
Hiding accessories or exiting Dock removes the observers. Mouse event payloads are not retained,
keyboard events are not monitored, and no additional OS permission is requested. Native telemetry
counts observer events to distinguish callback delivery from frontend dismissal.

The repaired prototype was rebuilt and exercised live. Entering the independent host's native
full screen produced one application-activation callback: React closed the toolbar, Agent Control
reported no open UI surfaces, the global revision remained 1, and native telemetry showed the
outside observer disabled afterwards. Reopening the toolbar and clicking Views kept both the
toolbar and editor visible, confirming that internal Dock clicks are not treated as outside
interactions. The two focused accessory suites passed (43 tests), and Objective-C syntax with
`-Wall -Wextra`, Cargo formatting and whitespace checks passed. The user then repeated the real
mouse check and confirmed that clicking the black background closes both the toolbar and Views
editor correctly. This completes the core single-display interaction probe, including the earlier
manual confirmation of normal-window restoration. It does not expand the platform/test matrix.

The native-only shell-recreation solution for toggling Above Full Screen has **not** been ported
to the Tao-owned windows. This integration probe exercises the on case only. Multi-monitor,
Stage Manager, notch policy, actual browser/video full screen, capture continuity and macOS 14.2
remain outside the evidence gathered here.

## Next architectural investigation

Do not ship the shortcut that turns every Tao window into a permanently nonactivating Panel.
Ordinary-user activation now has one successful manual result. A production constructor option
must still have explicit role and lifecycle behavior rather than globally replacing every window.
If broader testing finds ordinary-window regressions, investigate a separate Panel shell while
preserving one React/audio runtime.

Tauri has a `Webview::reparent` API, but the pinned source rejects reparenting a WebviewWindow
without the `unstable` feature. Command injection also checks `is_webview_window()`, and frontend
current-window metadata is initialized with its original label. A two-shell design is therefore
another integration prototype, not a safe one-line replacement or permission to bypass Tauri's
window/IPC ownership. A production constructor extension, dependency ownership, window identity
and lifecycle design need an explicit decision after that investigation.

## Checks and local artifacts

- Final prototype dev executable builds successfully with the temporary Tao source override.
- Six focused frontend/security/dependency suites: 122 tests passed. One initial parallel run
  timed out in an unchanged Snapshot-toolbar test; isolated reproduction and the full selected
  suites with one worker passed without changing test timeouts or test source.
- Rust Dock unit tests with dev identity and the override: 19 passed. Subsequent activation-only
  edits were compiled and exercised live; those edits do not change the pure geometry tests.
- Cargo formatting, shell syntax and whitespace checks passed.
- No full repository gate or publication was performed. No capture-layer code changed.

Ignored local evidence is in `artifacts/macos-dock-prototype/tauri/`: screenshots, baseline and
mutation snapshots, cycle results, before/after process-restart state, and native telemetry from
the original and modern activation attempts. Application-source mutations use the existing UI
business functions and revision-checked Agent Control. Test drafts and display preferences were
restored. The user confirmed normal-mode restoration, reported the original outside-click defect,
and confirmed its repair in a second manual check. The original automated activation uncertainty
and the initial outside-click failure remain documented above to explain the evidence boundary.
After the final check, normal mode was restored and the temporary test applications were closed.

## Formal implementation handoff

The shipping implementation replaces the temporary source override, environment gate and debug
telemetry. Their original scripts/source were retained in ignored local evidence under
`artifacts/macos-dock-prototype/archived-launchers/`; they are no longer build inputs.
`stage-dev-app.py` remains a development-only LaunchServices wrapper for the normally built dev
executable and sets no prototype environment. The independent native fixture remains reproducible.

## Formal implementation validation

The production path now uses the pinned, feature-gated Tao vendor and the main-thread
`macos_dock_window` owner for all app identities. No prototype environment switch, temporary Cargo
source override, live class replacement or debug telemetry is required. Agent Control UI reveal
and macOS Reopen also honor Dock presentation; Reopen resumes through the existing React lifecycle
via the runtime command mailbox. Its decision excludes the transparent probe from visible-window
counting. System application hiding pauses reconciliation until unhidden.

Evidence from the single built-in display:

- The 590-file JavaScript/script suite passed all 6,353 tests, including the new native geometry and
  visibility policy harness, window-factory boundary, macOS Views and Agent Control cases.
- `npm run rust:check` passed formatting, workspace/all-target Clippy with warnings denied and the
  workspace tests; the application library reports 807 passed and 3 deliberately ignored.
  Vendored upstream Tao emits its existing dependency warnings; no upstream cleanup is included.
- The full gate's frontend portion (license review, website contracts, formatting, lint, types,
  tests and production build) passed. Its first native phase found an implementation compile
  error; it was corrected and the complete native gate was rerun successfully.
- Before/after ordinary-form screenshots are both 2326 x 1580 and byte-identical, SHA-256
  `0811b66f9241a71b5d4ed29185a9f72f04b7f8f702805190ccf83f272f5a3929`.
- Above Full Screen on renders the 2940 x 314 strip while the independent host reports itself
  foreground, key and on the active native full-screen Space. Switching off stops visible-frame
  settlement; leaving full screen restores the same strip pixels. A hidden-target render timeout
  is supporting evidence, not a direct native visibility query.
- In the final normally built dev executable, Agent Control opens both the toolbar and Views
  while host telemetry still reports foreground and active full-screen membership. Views exposes
  the switch and `dock describe` reports it writable. The screenshot includes the editor's
  intentional transparent room for select menus.
- An actual process restart restored the saved bottom Dock at 157 CSS pixels. Explicit Hide and
  Show went through the production lifecycle and changed `dock.suspended` true then false. Window
  visibility does not advance the global revision; the test reinspected after a revision conflict.

A direct Cargo build used briefly during the last restart check lacked Tauri's dev overlay, despite
having the dev Cargo feature. It was stopped before Dock mutations; its settings/readback are
excluded from acceptance. The executable was rebuilt through `npm run desktop:dev` and retested.
The development staging helper now refuses a latest build whose Cargo fingerprint lacks the dev
Tauri configuration. This prevents the same test-identity mismatch from recurring.

The earlier prototype's outside-click and ordinary-mode restoration were confirmed by the user.
The formal build's real-mouse Above Full Screen off/desktop-return check is requested separately.
Multiple displays, per-display Spaces configuration and Windows/Linux execution are not established
by this Mac session. No audio-callback or capture implementation was changed.
