# macOS Dock window-avoidance experiment

The overlay Dock was restored in `b4590697`. This experiment investigates whether ordinary host
windows can leave room for that strip without a Windows-style system work-area registration.
It does not enable Reserve Screen Space in the product.

## Evidence and hypothesis

- Apple's [`NSScreen.visibleFrame`](https://developer.apple.com/documentation/appkit/nsscreen/visibleframe)
  is read-only and excludes the system Dock and menu bar. No public work-area reservation API was
  found during this investigation; this is a search finding, not proof that every approach is impossible.
- [`AXUIElementSetAttributeValue`](https://developer.apple.com/documentation/applicationservices/1460434-axuielementsetattributevalue)
  can set attributes supported by another application's accessibility implementation. Window size
  and position must be checked for writability; applications can refuse requests or impose constraints.
- [Sidebar's own changelog](https://sidebarapp.net/changelog/) describes resizing windows to prevent
  overlap, including a fix for resizing while collapsed. This is evidence of an alternative product
  approach, not evidence of which internal APIs it uses.

Hypothesis: an opt-in accessibility client can resize or move a supported ordinary window away
from the Dock. This is reactive window management. It does not change `visibleFrame`, register an
exclusive screen region, or establish behavior for native full-screen Spaces.

## Isolated probe

The wrapper builds an ad-hoc signed `PLVS Dock Probe.app` under ignored
`artifacts/macos-dock-reservation/`. Source remains in
`scripts/macos/dock-reservation-probe.swift`. Neither PLVS's runtime nor its settings are changed.
Rebuilding the executable can require granting its accessibility permission again.

```sh
node scripts/spike-macos-dock-reservation.mjs self-test
node scripts/spike-macos-dock-reservation.mjs status
# Only after the operator authorizes the permission request:
node scripts/spike-macos-dock-reservation.mjs request-permission
node scripts/spike-macos-dock-reservation.mjs list --pid <test-host-pid>
node scripts/spike-macos-dock-reservation.mjs plan --pid <test-host-pid> --window 0 --edge top --height 56
node scripts/spike-macos-dock-reservation.mjs apply --pid <test-host-pid> --window 0 --edge top --height 56 --journal artifacts/macos-dock-reservation/top.json
node scripts/spike-macos-dock-reservation.mjs restore --journal artifacts/macos-dock-reservation/top.json
```

`status` never requests permission. `plan` and `list` never change window geometry. There is no
background watcher. `apply` targets one explicit PID/window index, refuses PLVS windows, minimized
windows, nonstandard windows and full-screen windows, and writes recovery data before mutation.
Journal files must be new paths and remain local; they contain the test window's title and geometry.
A failed move or a host-imposed minimum size retains the observed geometry for diagnosis/recovery.

`restore` verifies the process launch time against PID reuse, requires exactly one window matching
the recorded title and applied/observed geometry, and refuses to overwrite subsequent user changes.
If the host changed its title or geometry, or a partial failure prevented observing geometry,
automatic restore may refuse; the journal retains the original rectangle for manual recovery.
Use a disposable host window with no unsaved work for the first real test. Window indices can
change when the host opens or closes windows; re-list immediately before planning or applying.

Geometry uses AppKit/AX points, not PLVS's persisted physical pixels. Screen coordinates are
converted using the primary screen's top edge; other screens may have negative coordinates.
The reserved strip is subtracted from the current visible work area, preserving system UI space.

## Disposable native host and repeatable verification

`scripts/macos/dock-reservation-host.swift` creates an AppKit window with no documents or user
data. It records its own `NSWindow.frame` in AX coordinates so validation does not merely compare
two reads from the probe. A control file accepts only actions on that process's own window:
reset, compact, minimum-size constraint, move, minimize, and quit. The host exits after ten minutes.
It does not need Accessibility permission. The probe still requires permission for cross-process AX.

After granting **PLVS Dock Probe** permission in System Settings → Privacy & Security →
Accessibility, run:

```sh
node scripts/verify-macos-dock-reservation.mjs
```

The verifier creates and owns a new host process, checks top-56 and bottom-160 avoidance against
native host geometry, checks exact restoration, unchanged nonoverlapping geometry, refusal to
restore after a subsequent move, and refusal to operate on minimized windows. It also records
whether AppKit enforces the configured minimum size (`hostAdjusted`) or accepts the proposed size.
Each run uses fresh journals in an ignored UUID directory and closes its fixture in cleanup.
It never selects an existing application as its target. A missing permission fails before launching
the host. LaunchServices starts the fixture (`open -n -W`); direct Mach-O execution did not supply
the launch identity required by the probe's PID-reuse guard on this machine.

Real AX execution became available when `status` returned `trusted: true`. The operator reported
not seeing a separate Probe permission entry. Effective AX trust is verified; the exact responsible
application in macOS privacy settings was not established and should not be inferred from the bundle
name. A production application must independently verify permission with its own signed identity.

The first native restore exposed an AppKit constraint: growing the window before moving it away
from the bottom edge clipped its height. Moving afterward did not restore that clipped size.
`setGeometry` now makes at most one additional size/position correction after the first pair of AX
writes. This fixed the observed restore failure; it is not a continuous retry loop. Failed restores
also update the journal with the latest observed geometry for a guarded later recovery attempt.

## Validation and remaining work

- Swift compilation and geometry self-tests passed: primary-screen conversion, a monitor above and
  left of primary, both edges, unchanged nonoverlapping windows, and invalid height rejection.
- Initial permission refusal was verified before permission became effective. The final disposable
  host run passed all asserted checks in
  `artifacts/macos-dock-reservation/run-1903ecb9-5981-48da-88b2-fcde64a234eb/results.json`:
  top-56 shifted AX y from 33 to 89 and reduced height from 923 to 867; bottom-160 reduced height
  to 763. Both restored the original 1470×923 rectangle at (0,33), independently checked against
  native `NSWindow.frame`. Nonoverlapping geometry was unchanged, subsequent move prevented
  restore, and minimized windows were refused. AppKit can expose minimized windows as nonstandard
  subroles, so either eligibility guard can reject them.
- The minimum-size fixture returned `hostAdjusted`: height stayed 923 despite requesting 867,
  while y moved to 89. Its original geometry was restored successfully. This cannot guarantee a
  reserved strip for applications whose minimum size exceeds the available area; product behavior
  must treat that as unsupported instead of reporting successful reservation.
- `npm test`: 479 files passed; 5207 tests passed, 4 skipped. Swift strict formatting, compilation,
  geometry self-tests, and wrapper syntax/format checks passed.
- Next: test an operator-selected real application/DAW and record its minimum-size and snapping
  behavior. These results establish ordinary AppKit cross-process geometry control, not production
  integration or support for every application's window implementation.
- Before product integration: define event monitoring, drag/resize handling without fighting user
  input, multiple PLVS instances, monitor changes, permission revocation, app exit/crash recovery,
  and coordination with third-party window managers. Full-screen Spaces are a separate experiment.

## Integration constraints established by the probe

- Do not just widen `supportsDockReserveSpace()` or `DockStateRecord::normalize_for_platform()`.
  The current Windows flag means Shell registration succeeded. macOS needs a permission and
  window-management lifecycle before it can report an active state.
- Acquire the existing monitor/edge ownership guard before changing host windows. A second PLVS
  instance must not reserve the same edge or restore another instance's journal.
- Observe window creation, move, resize, application launch/exit, and monitor/Space changes. Coalesce
  events and distinguish acknowledgments of PLVS's own writes; the bounded correction in this
  probe must not become an unbounded notification feedback loop.
- Restore only windows still at the last geometry PLVS applied, with the same process identity.
  Preserve later user/window-manager changes. Record partial failures and recover only after
  checking identity and current geometry again. Restoring every saved original frame blindly is
  unsafe even on a normal Dock exit.
- Recheck host results. A successful AX return code is not proof of fit, and a minimum-size failure
  can move the window without shrinking it. Product fallback must avoid leaving that partial
  adjustment in place while claiming success.
- Production permission checks must run under PLVS's own signed application identity. A successful
  probe launched by a development host does not establish the installed application's TCC state.

## Runtime integration and validation

The runtime implementation now lives in `src-tauri/src/macos_dock.rs` and
`src-tauri/native/macos/dock_reservation_bridge.m`, with the existing React Dock business path,
header action, Preset flow and Agent Control availability updated. The runtime considers the settled
foreground standard window; it does not enumerate and adjust hidden application windows. AX work is
serial and bounded to one in-flight snapshot. Failed fits roll back instead of leaving a partial move.
Production journals are atomic replacements with mode 0600. macOS uses one display-wide owner;
independent top/bottom owners would create conflicting restoration baselines. Permission loss keeps
the ownership lease when restoration cannot complete, preventing a new owner from racing old recovery.

`scripts/smoke-macos-dock-reservation.mjs <development-plvs-cli-path>` requires
`PLVS_INSTANCE_ID` and optionally `PLVS_SECOND_INSTANCE_ID`. It runs capabilities/inspect first,
uses current revisions for native changes through React, launches an owned native host, checks
actual `NSWindow.frame`, restores Dock preferences and closes its host. The packaged run with both
instances passed in `artifacts/macos-dock-reservation/integration-40e6afc9-103b-4f9d-a7ec-ac55383d9ca6/`:

- top-56 and bottom-160 automatic avoidance and Dock-exit restoration;
- unchanged nonoverlapping windows and preservation of subsequent user changes;
- host minimum-size rejection with rollback of the partial move;
- minimized-window exclusion;
- competing workbenches on the same and opposite edges both resolve to overlays while the first
  owner's reservation remains enabled.

The packaged application initially lacked Accessibility permission, unlike the raw development
process. Its real request failed with `applicationFailed`, leaving the normal window and disabled
reservation intact. The operator explicitly granted **PLVS Dev** permission; the packaged smoke then
passed. This establishes that runtime permission checks occur under the packaged identity.

Manual lifecycle checks used a disposable host with no user documents. Quitting PLVS via Command-Q
restored 1470×923 at (0,33) from the top-56 adjusted 1470×867 at (0,89). A cold start restored the saved
reservation. Killing the owned test PLVS process left the adjusted host and its journal in place;
starting PLVS again recovered the same host identity, and exiting Dock restored its full original
frame. The journal then became empty. Normal, top-56, reservation-disabled preferences were restored
after validation. Test hosts were closed.

Agent Control screenshots of the previous and new Dock header were inspected. Both are 2940×88
physical pixels; the new Reserve action fits without clipping. The final complete merge gate passed:
479 Vitest files, 5209 tests passed and 4 skipped; Rust library tests 695 passed and 1 ignored, plus
workspace/integration suites. A final Rust check covers the ownership-retention refinement.
Its unit/integration checks passed; concurrent debug bundling replaced the un-hashed Rust library
before rustdoc ran, causing missing-crate errors. Re-running `cargo test --workspace --doc`
sequentially passed. Final debug bundling succeeded, and the packaged smoke passed again with the
ownership refinement and updated fixture in
`artifacts/macos-dock-reservation/integration-891c13dc-7e71-412a-8b1f-e60d825a72e0/`.

Remaining compatibility coverage: real third-party applications, multiple physical displays,
third-party snapping managers, permission revocation during use, and native full-screen transitions.
Those were not tested on this single-display machine. Public documentation and ADR 0023 define the
current foreground-window contract and best-effort recovery limits.
