# Dock control area implementation plan

Date: 2026-10-16
Status: In progress; initial vertical controls implemented, update accessory and final validation pending
Design: [Dock Control Area](../specs/2026-10-16-dock-control-area-design.md)
Worktree: `.codex/worktrees/update-preferences`
Branch: `codex/update-preferences`
Related plan: [Update preferences](2026-10-16-update-preferences.md)

## Delivery order

D1 establishes geometry and visual evidence; D2 adds the fixed-width vertical controls and removes
the toolbar pill. D3 consumes U4's shared update state/details and U5's guarded actions. D4 completes
cross-platform validation and documentation. Do not create a separate Dock updater while waiting
for those dependencies. Keep work on the authorized worktree and branch.

## D1. Measure and select the fixed layout

- [ ] Read `docs/pitfalls.md` Dock geometry/rendering sections and the architecture screen-space
      rules. Start the isolated dev app with the worktree's configured identity/data paths.
- [ ] Discover Agent Control capabilities and capture baseline Dock strip, toolbar, normal window,
      and representative panel screenshots before modifying rendering.
- [ ] Inspect `SourceTransportCluster.jsx` and `sourceTransportState.js` for real timecode lengths,
      labels, unavailable states, and Snapshot actions. Do not infer formats from a mockup.
- [ ] Prototype a presentation variant of the actual component: timecode above primary action,
      then toolbar icon, return icon, and optional update icon. Keep the group top-aligned.
- [ ] Compare the narrowest usable fixed widths with supported interface sizes, large text/DPI,
      long timecodes, all transport states, and the full update-present stack. Use real click targets.
- [ ] Select and record width, row sizes, spacing, and minimum height with screenshot evidence.
      Width must remain stable across height/state changes. No sideways fallback or hidden timecode.
- [ ] Check all panel families at the proposed minimum. Reconcile compact/standard/expanded
      thresholds and document saved-height clamping; do not simply change the frontend constant.

Files to inspect: `src/dock/{dockSizing.js,dockTokens.css,dockPanelSizing.js}`,
`src/hooks/useDockMode.js`, `src-tauri/src/{dock.rs,macos_dock.rs,dock_accessories.rs}`,
and native window restoration code. Resolve references from source before
editing; do not hand-edit generated theme assets.

## D2. Implement persistent controls and shared transport presentation

- [ ] Add the Dock layout variant to `src/components/SourceTransportCluster.jsx`, retaining the
      current normal-window layout and shared status/action/disabled logic. Omit only the redundant
      fixed source label; retain timecode and the primary action at every supported height.
- [ ] Replace `DockToolbarToggle.jsx`'s full-height 20px strip with a composed control-area component
      in `DockStrip.jsx`. Reuse IconButton, tooltips, and existing toolbar/return callbacks.
- [ ] Keep the exact order: timecode, transport, toolbar, normal return, optional update. Update
      absence must not redistribute the permanent controls or show a placeholder button.
- [ ] Wire transport to the existing business function and normal return to
      exitDockRestoringAttributes; do not mutate capture/window state directly.
- [ ] Remove SourceTransportCluster from `accessories/DockHeader.jsx` and simplify the equal-width
      center layout. Preserve the toolbar tools, notices, editor anchors, and dismissal behavior.
- [ ] Audit automatic toolbar visibility rules that existed to expose transport/Snapshot. Retain
      behavior needed for editors/notices, and eliminate dependencies on the removed pill without
      making the persistent transport disappear.
- [ ] Update width tokens, panel viewport calculations, recording-indicator placement, native
      minimum height, startup restore/clamping, resize bounds, and Agent Control Dock limits together.
      Preserve user panel sizes/order and normal-window geometry.
- [ ] Synchronize schema/read/patch/capabilities/docs/tests for changed Dock bounds, regenerating
      generated command documentation only through its supported generator.

Tests: transport presentation/action parity, Dock order and visibility, stable control width,
toolbar behavior without its pill, return preserving capture/history, saved-height clamping, and
native/frontend bound agreement. Use jsdom declarations for React tests; do not assert arbitrary
sentences instead of behavior. Pixel evidence remains necessary for dimensions and compositing.

## D3. Add update status and shared accessory details

Depends on U4's serializable update view state and U5's confirmed-install contract.

- [ ] Extend `DockAccessoriesContext.jsx`, `accessoryProtocol.js`, and the bridge/client surface
      with the necessary update snapshot/actions. Keep native resource handles and package ownership
      in the controller. Reject stale/duplicate confirmation requests at the owner.
- [ ] Show the optional trailing icon for available/downloading/ready/actionable-error states,
      with useful tooltip/accessibility text. No blinking, focus stealing, or background modal opening.
- [ ] Host the shared UpdateDialog content in an independent accessory surface, integrating native
      creation/lifecycle in `src-tauri/src/dock_accessories.rs` and frontend accessory routing. Do not
      squeeze a normal modal into the Dock strip or rebuild changelog rendering in a separate component.
- [ ] Reuse existing accessory creation where suitable; ensure the update view cannot discard an
      open editor draft. Record the chosen toolbar/editor coexistence and focus policy before wiring
      dismissal. Repeated clicks focus the existing details surface rather than spawning duplicates.
- [ ] Place details inside the correct monitor work area for both Dock edges and scaling settings.
      Closing/Escape returns focus appropriately without exiting Dock or changing capture/history.
      While installation has begun, dismissal cannot cancel or duplicate the native operation.
- [ ] Support the startup offer with Update and Restart / Skip This Time in this surface when a
      saved Dock session opens. The first-launch preference choice must also be accessible in Dock,
      using the shared setup content; do not allow hidden UI to trigger requests before choice.
- [ ] Keep displayed release notes and confirmation target frozen together. Reflect owner progress,
      failures, and platform capability; Portable offers a ZIP route and Preview has no updater UI.
- [ ] Extend visual-capture readiness and surface metadata for the new window so Agent Control can
      verify it. Follow existing capabilities/permissions and surface synchronization conventions.

Test stale accessory snapshots, repeated open, shared controller ownership, frozen update target,
close/skip versus install, startup restored Dock, existing editor coexistence, and owner loss.
Exercise real native focus, clipping, placement, and installation handoff separately from mocks.

## D4. Validate and document the combined behavior

- [ ] Compare before/after Agent Control screenshots with the same panel state. Cover minimum and
      taller heights, top/bottom edges, longest timecode, Live/Stopped/Snapshot, no update/available/
      downloading/ready/error, interface sizes, and Windows display/text scaling.
- [ ] Verify native Windows and macOS layout, restoration, accessory focus, and work-area reservation.
      If a platform is unavailable, record the gap rather than claiming cross-platform completion.
- [ ] Verify height changes and update arrival do not move permanent controls horizontally or
      resize the panel viewport. Confirm a new minimum only clamps out-of-range saved heights.
- [ ] Verify normal-window transport remains unchanged, toolbar tools still work, and returning to
      normal mode leaves measurement running. Check recording indicator placement and resize handles.
- [ ] Run U6's shared update scenarios through Dock, especially offline staged offers, skip,
      Portable routing, active peers, blocked editors, and failure recovery.
- [ ] Update `docs/user/workspace.md` and/or `system-settings.md` according to their existing Dock
      sections, plus update guidance, architecture, and CLI bounds where affected. Explain any minimum
      height change and remove obsolete instructions about the centered toolbar transport.
- [ ] Before implementation commits run `npm test` plus frontend format/lint/typecheck and
      `npm run rust:check` when touching Rust. Run relevant native geometry tests. Before push/merge,
      run `npm run check:changes` and its full mixed-change gate.

Record chosen dimensions, screenshots, test results, platform evidence, and unresolved limitations
in this plan during execution. Do not mark complete until geometry and accessory behavior have
been verified in the actual app; browser previews and component tests alone are insufficient.

## Component and ownership map

| Existing surface             | Planned change                                                            | Behavior owner                                       |
| ---------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| `SourceTransportCluster.jsx` | Add a vertical presentation variant with shared status/action rendering   | Existing derived transport state and action callback |
| `DockStrip.jsx`              | Compose a fixed-width control area beside the panel viewport              | Main application, not an accessory timer/controller  |
| `DockToolbarToggle.jsx`      | Reuse or extract arrow/open-state rendering as an icon-sized action       | Existing toolbar visibility hook                     |
| `accessories/DockHeader.jsx` | Remove transport and center-spacer assumptions                            | Existing toolbar/editor actions                      |
| `DockAccessoriesContext.jsx` | Publish update presentation and route guarded actions                     | Shared U4 update controller                          |
| `UpdateDialog.jsx`           | Extract reusable details body/actions from its modal host as needed       | Shared update controller; host owns window dismissal |
| `dock_accessories.rs`        | Add/reuse a separately hosted details surface with lifecycle and geometry | Native accessory manager                             |

Do not mount a second timer for the vertical transport. The current derived Live state uses
`statusLabel` for the clock while running/in Snapshot and shows `Ready` when stopped. Preserve that
existing stopped-state behavior unless separately redesigned; "timecode row" names the shared
status area, not a requirement to invent a stopped-session timestamp.

`formatClock` pads hours to two digits but does not cap their length. D1 must include 99-to-100-hour
and longer-duration fixtures. A finite narrow width cannot promise an unlimited number of hour
digits at a fixed font size. Record the supported display envelope and a legible fixed-width
overflow treatment before choosing dimensions; do not truncate time silently, change its meaning,
or let a rare long session resize panels. Escalate an actual formatting tradeoff with visual
examples if it cannot preserve the agreed information within the selected width.

## Dimension selection worksheet

Fill this table during D1 with measured values and screenshot paths, not guessed final constants.

| Quantity                         | Constraint                                                                    | Recorded result     |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| Control width per interface size | Full status/time display and usable action target; independent of Dock height | Pending measurement |
| Status row height                | Legible text with no clipping under supported text scale                      | Pending measurement |
| Transport target height          | Easily clickable without overlapping neighboring controls                     | Pending measurement |
| Three utility target heights     | Toolbar, return, and update all fit when update is visible                    | Pending measurement |
| Padding/gaps/resize clearance    | No collisions with the Dock resize handle or recording indicator              | Pending measurement |
| Dock minimum height              | Status + transport + three utility targets + gaps/padding/clearance           | Pending measurement |

Measure the whole stack with the update visible; its absence must not lower the supported minimum
and allow a later update to grow the Dock. Inspect top/bottom screenshots and panel viewport widths
before/after toggling every update state. Check work-area constraints and maximum-fit calculations
when raising the minimum, including small displays with large accessibility text settings.

## Accessory-window behavior to implement

Use the existing revisioned accessory protocol, adding an explicitly registered surface if needed
(proposed name: `dock-update`). Update all surface allowlists, native permissions, theme/interface
size propagation, ready/focus events, and visual-capture mapping together. Do not grant arbitrary
new native capabilities to the accessory just because its UI can show an Install button.

Proposed concrete lifecycle, to validate against existing editor behavior:

1. Indicator click requests a pinned details target from the owner, creates/shows the single
   details window, and focuses it. A repeated click focuses the existing window.
2. The toolbar can remain visible. An editor with a draft is never closed or replaced just to show
   updates; installation still honors its blocking status. Position the details without sacrificing
   the editor state, using the same monitor work-area rules.
3. Details remains open on ordinary focus loss so selecting text or following a changelog link does
   not dismiss it. Close and Escape dismiss it while idle; startup dismissal means Skip This Time.
4. Busy installation retains the existing non-dismissible behavior. Native close requests must go
   through that same guard; hiding the WebView must not cancel an installer operation.
5. Returning to normal mode transfers the pinned details presentation to the normal host if open,
   then hides the accessory. Switching forms does not install, skip, or create a second controller.
6. If the owner disappears, disable actions immediately and close/recover through the established
   owner lifecycle; never let a stale accessory issue an installation against a different owner.

If native window focus rules conflict with this lifecycle, record the actual behavior and revise
the hosting mechanism rather than silently treating focus loss as consent to discard a draft.

## Focused verification matrix

| Scenario                             | Assertions                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| Live / Ready / Snapshot              | Shared status, matching action kind, exactly one transport, correct enabled state     |
| No update to ready update            | Same permanent button coordinates and panel viewport width                            |
| Minimum to tall Dock                 | Same control width; no sideways layout or disappearing status row                     |
| Old 56px stored height               | Native/frontend restore clamps consistently; panel settings survive                   |
| Toolbar open and editor active       | No orphaned spacer, correct editor anchors, draft preserved on details open           |
| Details close / Escape / blur        | Close and Escape dismiss idle details; blur alone does not; no capture mutation       |
| Dock to normal with details open     | One pinned target, one details host, no duplicate install actions                     |
| Update becomes stale while displayed | Same frozen target or explicit stale message; never silently installs another version |
| Startup staged update in Dock        | Visible details offer, skip works, no automatic installation                          |
| Text scale and long clock            | Legible status, stable width, no overlap or silently lost time information            |

Suggested focused commands, followed by full pre-commit checks for the touched scope:

```powershell
npx vitest run src/components/SourceTransportCluster.test.jsx src/lib/sourceTransportState.test.js src/dock
npx vitest run src/agentControl/settleDockAccessory.test.js src/components/UpdateDialog.test.jsx
npm run format:check
npm run lint
npm run typecheck
npm test
npm run rust:check
```

Confirm exact test filenames before running a focused command if refactoring renames a component.
For live validation, start `npm run desktop:dev` in the worktree; discover `capabilities` and inspect
the revision through `npm run desktop:control -- ...` before mutations. Capture supported targets
through Agent Control, including the new details surface after its capture mapping is implemented.
Do not manipulate native geometry directly to manufacture a passing screenshot.

## Suggested reviewable commits and integration handoff

| Order | Suggested subject                                                | Required evidence                                                             |
| ----- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1     | `refactor(transport): support vertical Dock presentation`        | Shared action parity and unchanged normal pill                                |
| 2     | `feat(dock): add persistent vertical controls`                   | D1 dimensions, D2 composition, toolbar cleanup, synchronized bounds and guide |
| 3     | `feat(dock): show update status and shared release details`      | U4/U5 contract, accessory lifecycle, startup offer, revision guards           |
| 4     | `test(dock): cover control geometry and update window lifecycle` | Real visual/native matrix and final regression evidence                       |

Integrate the optional update icon only with genuine shared state; a development fixture may help
visual review but must not become production behavior. Keep per-step documentation/tests with the
behavioral commit rather than deferring all correctness work to the last testing commit.

Final combined review should trace one staged package from download in normal mode, through a full
quit, to a Dock startup offer, skip, manual reopening, and explicit installation. Also trace a
manual-only Portable copy through the same Dock entry to its ZIP download. These two paths catch
cross-feature gaps that separate transport and updater unit suites cannot reveal.
