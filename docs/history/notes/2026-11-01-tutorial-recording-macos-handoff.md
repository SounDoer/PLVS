# Tutorial recording — macOS hand-over (2026-11-01)

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
