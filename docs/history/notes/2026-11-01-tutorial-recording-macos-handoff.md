# Tutorial recording — macOS hand-over (2026-11-01)

Status: macOS implementation and local native acceptance are complete. The original hand-over below
is followed by the investigation and final acceptance results.

The tutorial-recording design
([2026-10-31-tutorial-recording-agent-control-design.md](../specs/2026-10-31-tutorial-recording-agent-control-design.md))
is implemented and verified on Windows. Three pieces need a Mac, because they can only be built and
tested there.

## 1. Dock region recording (T9)

Windows records `visual recording start --target dock` by capturing the strip's monitor and
cropping the strip's region, extended toward the screen centre by the toolbar and the tallest
editor (`dockRecordingRegion` in `src/agentControl/visualControl.js`). The frontend sends that region
as a rect in the strip's CSS pixels with `screenRegion: true`; `y` is negative for a bottom Dock.

On macOS:

- `src-tauri/src/visual_capture/mod.rs`: remove the `screen_region` refusal ("Recording the Dock is
  not supported on this platform yet.") once macOS can do it.
- `src-tauri/src/visual_capture/macos.rs`: add `"dock"` to the recording `targets`.
- `src-tauri/src/visual_capture/recording/macos.rs` and `src-tauri/native/macos/visual_capture_bridge.m`:
  when `screen_region` is set, capture the display that holds the main window (ScreenCaptureKit
  display filter rather than the window filter) and crop to the region converted from the strip's
  client CSS pixels to display points. The Windows equivalent is `region_crop_on_monitor` in
  `recording/windows.rs`; mirror its unit test.
- Update `docs/agent-control/visual.md`, which says `dock` is Windows-only.

Verify: enter Dock, `ui show toolbar-menu --menu presets`, record `--target dock`, switch to the
Views menu, stop, and check frames show strip, toolbar and editor in one picture. Recording already
needs Screen Recording permission on macOS.

## 2. Pointer movement and hover (T1)

`src-tauri/src/pointer.rs` warps with `CGWarpMouseCursorPosition` and posts a mouse-moved event so
the WebView sees hover; posting needs Accessibility trust for the running build. Untested on macOS.

Verify: `pointer move --target toolbar:presets`, wait a second, `visual screenshot --target main`,
and check the Presets hover tip and highlight. If hover does not appear, grant the dev build
Accessibility in System Settings → Privacy & Security and retry; if it still fails, the event post
is the place to look. Also record `--target main --cursor visible` while moving across several
targets and check the captured pointer lands on each control.

Hover could not be verified on the Windows test machine: something there kept warping the pointer
back to a fixed position about every few hundred milliseconds, while the moves themselves landed
exactly on the targets.

## 3. First-run recording recipe (T10)

Write the recipe into the PLVS-Promo repository: the dev identity build of the release commit
started on an empty `--plvs-test-app-data-root`, so the Quick Tour invitation appears with Agent
Control enabled. Recording notes worth carrying over:

- Turn Auto-hide Controls off for the Quick Tour, or its steps point at a hidden toolbar.
- A Dock take records what lies behind transparent surfaces; set Surface Opacity to 100 or prepare
  the desktop.
- `pointer move` reveals an auto-hidden toolbar before moving onto a `toolbar:` target.

## macOS continuation — 2026-11-01

The working implementation now threads `screen_region` through the macOS Rust/native boundary,
uses a ScreenCaptureKit filter for the main window's display for Dock takes, and converts the strip's
CSS rectangle into normalized display coordinates in Cocoa points. Ordinary window recording retains
its existing window filter. Display capture still disables system audio; measured-source audio keeps
its existing path. Dock is advertised in macOS recording capabilities and the CLI guide is updated.

Two native geometry tests exercise a bottom Dock extending above the strip on a Retina secondary
display with a negative desktop origin, and a top Dock with independent CSS scaling. Both run the
same native conversion used at recording start and geometry updates.

Local acceptance uses the packaged dev app with an isolated data root under
`artifacts/tutorial-macos-20261101/`; the installed stable app was not controlled. The source is
`c76d2d90` plus the pending macOS changes, so this is development evidence, not exact-commit release
acceptance. Command responses are retained in `commands.jsonl` beside the screenshots.

Observed so far:

- First launch opens Update Preferences before the Quick Tour invitation. Cancel through UI
  Navigation, wait for it to finish, then film the actual invitation. The invitation screenshot
  and the first tour step were captured; Start and all ten Next/Finish steps succeeded.
- Dock bottom entry with reservation disabled, the Presets toolbar/editor, and accessory screenshots
  succeeded. These separate screenshots are not evidence for combined region recording.
- macOS reports Screen Recording permission as required. A real main recording start returned
  `screenCapturePermissionRequired`, before a recording was created. Combined Dock recording and
  visible-pointer recording are pending that system permission.
- `pointer move --target toolbar:presets` succeeded, but its subsequent screenshot did not show a
  hover tip/highlight. Accessibility permission and a foreground retry remain necessary before
  concluding whether the native event posting works.

The first-run recipe is now in PLVS-Promo at `docs/recipes/macos-first-run-tutorial.md`, linked from
its production workflow. The CLI's `PLVS_TEST_IDENTITY_ROOT` points to `<app-data>/multi-instance`,
whereas the GUI's `--plvs-test-app-data-root` points to `<app-data>`.

Validation: `npm run check` passed (588 Vitest files / 6,275 tests, Rust formatting, Clippy, and
workspace tests including 806 library tests). Focused Visual Capture Rust tests passed (61 tests).
PLVS-Promo's existing `npm test` passed (14 tests). Real recording/hover acceptance remains pending
as described above; no capture-layer code was changed and no capture smoke/soak was claimed.

### Authorization retry

After the user enabled the permissions, System Settings showed Screen Recording on for PLVS Dev,
but recording was still refused after reopening the same bundle. The macOS TCC log explicitly
reported `Failed to match existing code requirement` for `com.soundoer.plvs.dev` and ScreenCapture:
the retained requirement had hash `c7f463d468a80efcf62283a3f3c2d154f2364b8a`, while this bundle has
`b14afbd669d2ca7326f3a181244238d5438af033`. The filtered evidence is retained as
`permission-signature-mismatch.log` with the other acceptance artifacts.

The user authenticated the System Settings Add operation. The exact current bundle path was entered
in its file picker, but automated confirmation repeatedly returned the path chooser to `/`. Manual
confirmation of that picker is pending; no additional build or signing change was made. Refresh
this same bundle's authorization, reopen the isolated app, then retry Dock recording and hover.
The Promo recipe now documents the stale ad-hoc-build authorization case.

### Final acceptance

Authorization was refreshed successfully by removing the stale PLVS Dev entry and adding the exact
current bundle again. Merely adding it while the stale entry remained did not replace its code
requirement. No further user authentication was needed after the initial System Settings unlock.

The hover failure was a coordinate error, not a missing mouse-moved event. Frame extraction showed
the cursor above the intended button, in the native-title-bar region. Replacing the global event
route, removing the warp, and sending an extra native hover arrival did not fix that position error;
none of those experiments remains in the implementation. The final fix resolves the actual visible
WKWebView client rectangle on the native main thread and converts Cocoa points to Quartz screen
coordinates. It uses the original warp plus mouse-moved event, with no title-bar constant, additional
hover simulation, presses, scrolling or typing. Two native regression tests cover a framed client
and an accessory on a secondary display with a negative origin.

The final packaged dev app, using the same isolated profile, passed:

| Take                     | Encoded output                              | Captured / dropped frames | Native evidence                                                                                                                    |
| ------------------------ | ------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `final-pointer-main.mp4` | H.264, 2002 × 1196, 30 fps, 4.667 s, silent | 140 / 0                   | Pointer travels through Views, Presets and Settings; the Presets frame shows the cursor on its button, highlight and tip together. |
| `final-dock-bottom.mp4`  | H.264, 2560 × 1534, 30 fps, 2.733 s, silent | 82 / 1                    | Strip, toolbar and editor share one frame; Presets switches to Views, with the pointer on the toolbar.                             |
| `final-dock-top.mp4`     | H.264, 2560 × 1534, 30 fps, 2.733 s, silent | 82 / 1                    | The same combined-region and pointer checks at the top edge.                                                                       |

Each Dock take reports one startup dropped frame. All three videos passed full FFmpeg decoding;
ffprobe metadata, extracted frames, screenshots, command responses and `final-recordings.json` are
retained in `artifacts/tutorial-macos-20261101/`. `presets-hover-corrected-detail.png` and
`final-pointer-main-detail.png` show the corrected hover at pixel level.

The full `npm run check` passed before the final coordinate correction; the unchanged frontend
passed 588 Vitest files / 6,275 tests. After the final coordinate change, `npm run rust:check` passed
formatting, Clippy and workspace tests, including the two new native pointer geometry cases.
PLVS-Promo's 14 existing tool tests also passed. The final source has no remaining hover-event
experiments. Bottom/top native recording was exercised on this Mac's current monitor; negative
secondary-display geometry has unit coverage, not a second hardware-monitor acceptance run.
Measured-source audio and long recordings were not retested in this silent tutorial acceptance.
This remains working-tree development acceptance, not an immutable release-commit recording.

The Dock was exited after the takes, final state/permission inspections were saved, and the isolated
dev app was closed. The isolated profile and artifacts remain available for review. Final focused
documentation, pointer-handler and visual-contract tests passed (4 files / 37 tests); both repository
diffs passed whitespace checks.
