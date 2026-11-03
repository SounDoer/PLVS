# macOS Dock native feasibility probe

> Historical experiment. The superseded prototype scripts have been archived under ignored
> `artifacts/macos-dock-plugin-integration/retired-prototypes/`. The final integration uses the
> crates.io plugin; see the dated plugin integration note for current validation evidence.

Date: 2026-11-03. This is an investigation record, not the shipped Dock contract.

## Scope and agreed behavior

- Keep existing opt-in AX avoidance for ordinary desktop windows.
- Above Full Screen defaults on; full-screen content is overlaid, never resized.
- Clicking the strip or toolbar must not switch away from the host's full-screen Space.
- Try to support editor keyboard input in that same Space.
- Keep top-edge content clear of the notch and unavailable system regions.

## Reproduction

Run `bash scripts/prototypes/macos-dock/build.sh` from the repository. It compiles three
temporary app bundles under `$TMPDIR/plvs-macos-dock-probe` using the installed Xcode SDK:

- `PLVS Probe host.app`: an independent, ordinary AppKit application with native full screen.
- `PLVS Probe window.app`: focusable NSWindow control, approximating the window kind used by Tao.
- `PLVS Probe panel.app`: nonactivating NSPanel with the same WKWebView controls.

Launch the host, enter native full screen using its green button or Control-Command-F, and
launch the overlay variants separately. Use Toolbar, Open Editor, Cancel, Escape, the visibility
toggle and Return to Normal. The app menu includes Activate Probe to explicitly select a
foreground identity when needed. Return to Normal creates a fresh ordinary window: it does
**not** validate restoration of PLVS's existing main window.

Each app writes JSONL to `$TMPDIR/com.soundoer.plvs.dock-probe.<role>.jsonl`, overwriting its
previous run. Samples include foreground bundle ID, active-Space membership, frame, key status,
visibility and presentation options. Frames are AppKit points, not persisted PLVS physical pixels.
The probe does not request AX, input-monitoring or screen-recording permissions and does not
read PLVS settings or start audio capture. Quit the apps after testing.

## Observed results

Environment: Apple Silicon, macOS 26.3 (25D125), one attached screen, 1470 x 923 AppKit points.
Automated input used CUA, including coordinate mouse input and keyboard input. The full-screen
host and overlay are separate processes with separate bundle identities. This is a native
feasibility probe, not an end-to-end PLVS acceptance test.

| Scenario                                                                                                      | Observation                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary borderless NSWindow, floating level, CanJoinAllSpaces + FullScreenAuxiliary + CanJoinAllApplications | `visible=true` but `onActiveSpace=false` while the host remains frontmost in native full screen. Observed with both a nonfocusable initial control and a focusable control. This rejects these configurations, not every possible NSWindow configuration. |
| Nonactivating NSPanel with the same level and collection behaviors                                            | `visible=true`, `onActiveSpace=true`; strip actions and toolbar/editor actions execute while the host remains the foreground bundle.                                                                                                                      |
| Editor keyboard input                                                                                         | WKWebView input receives `dock prototype 123`; editor is key and on the active Space while host samples continue to report native full screen and the host foreground bundle.                                                                             |
| Cancel and Escape                                                                                             | Cancel returns to the toolbar; Escape closes the toolbar and editor, leaving the strip available.                                                                                                                                                         |
| Change collection behaviors on an already joined Panel                                                        | Not sufficient to remove the strip from the active full-screen Space. Tested removing the joining flags and then hide/reconfigure/show with FullScreenPrimary.                                                                                            |
| Recreate native shells, retain their WKWebViews, use CanJoinAllSpaces + FullScreenPrimary for off             | Off produces `onActiveSpace=false` while host is still full screen. Exiting host full screen makes the strip available on the desktop again.                                                                                                              |
| Off/on round trip                                                                                             | The strip's `Running` button state and editor text `preserved draft` survive shell recreation; reopening the editor shows the retained text. Re-entering host full screen with the option on makes the strip available again.                             |
| Return to Normal                                                                                              | New ordinary window becomes available after hiding the overlays. In-place Tauri restoration remains untested.                                                                                                                                             |
| External click closing                                                                                        | Not verified: coordinate clicks reach the host's local mouse monitor, but the overlay's global monitor callback does not fire in these automated runs. Do not count the implemented callback as a passing test.                                           |

CUA can target an application's controls even when that window is not on the active Space.
Consequently, an accessibility tree or a successful button action alone is not evidence that
the overlay is present over full screen. The results above also check native active-Space
membership and the independent host's samples. Saved window screenshots show individual
surfaces, not a desktop composite.

`currentSystemPresentationOptions` was 1024 in the active full-screen host while the background
Panel process sampled 0. Do not use that property alone as this process's full-screen detector
without further investigation. `NSApp.active` can also be true in both processes during Panel
interaction; foreground bundle identity is the relevant evidence here.

Local evidence is under ignored `artifacts/macos-dock-prototype/`: initial window/panel samples,
input and normal-return samples, flag-switch samples, final shell-switch samples, a small
results summary and editor screenshots. These artifacts are local, not committed baselines.

## Implications for PLVS

The current macOS main window is a Tao-created NSWindow. Shared `aboveFullScreen` persistence
already exists, but the native command only applies behavior on Windows and the macOS UI hides
the switch. Accessory `set_focus()` explicitly activates the application in Tao; this is unsuitable
for an editor that should remain over the host's full-screen Space.

A nonactivating Panel with WKWebView is a demonstrated route, including keyboard editing.
Formal integration must preserve the existing React runtime, Tauri IPC identity, resize/focus
events, visual capture, native window handles, geometry ownership and normal-window restoration.
The probe's successful WebView transfer is evidence about AppKit view lifetime only; it does
not prove that transferring a Tauri-owned view preserves those contracts. Do not change the
Objective-C class of Tao's live window to NSPanel or assume the classes have compatible storage.

Next integration probe: establish a supported Panel creation/hosting boundary, verify actual PLVS
controls and Agent Control screenshots before/after, and exercise entry/exit repeatedly. Keep all
PLVS scene mutations in the existing business functions. No product runtime files were changed
in this investigation. The dev app was built and its live capabilities/inspect surface read;
this is environment readiness, not evidence of Panel integration.

Still required: external click behavior under ordinary user input, actual Tauri integration,
Safari/Chrome video full screen, multiple displays and independent Spaces, Stage Manager,
minimum supported macOS 14.2, top/notch geometry, menu bar/system Dock auto-hide, hotplug,
sleep/wake, app restart and capture continuity. The probe currently uses the bottom edge.

## Primary references

- [Apple: canJoinAllApplications](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct/canjoinallapplications)
- [Apple: becomesKeyOnlyIfNeeded](https://developer.apple.com/documentation/appkit/nspanel/becomeskeyonlyifneeded)
- [Apple: currentSystemPresentationOptions](https://developer.apple.com/documentation/appkit/nsapplication/currentsystempresentationoptions)
- Installed SDK `NSWindow.h`: NonactivatingPanel applies only to NSPanel or subclasses;
  CanJoinAllApplications is available from macOS 13.0, below PLVS's 14.2 minimum.
