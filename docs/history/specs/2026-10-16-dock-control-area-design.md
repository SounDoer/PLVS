# Dock Control Area

Date: 2026-10-16
Status: Implemented at 72 CSS px width and 136 CSS px minimum height; final design and platform acceptance pending
Branch: `codex/update-preferences`

## Problem

Users who remain in Dock cannot see the normal-window update notification. Transport is available
in the expanded Dock toolbar, but reaching it requires an extra interaction. Returning to the
normal window also needs a readily accessible control.

Replace the right-hand toolbar-toggle strip with a narrow, persistent control area. Reuse existing
components and business actions, adapting presentation rather than creating parallel behavior.

## Agreed layout

The control area has a fixed narrow width and a top-aligned vertical layout. In order from top to
bottom:

1. Timecode.
2. Transport primary action: Start, Stop, or the existing return-to-Live action as appropriate.
3. Show/Hide Toolbar.
4. Return to Normal Window.
5. Update status, only when an update or associated download/ready state needs to be shown.

The same order applies to both top-edge and bottom-edge Dock. The toolbar arrow still reflects
the direction in which the toolbar opens and whether it is currently open.

Toolbar, return, and update controls are icon buttons with accessible names and hover tooltips.
The transport action uses the existing action semantics; its compact presentation may omit a text
label if the icon, tooltip, and accessible name unambiguously identify the action.

The update control is last. Its appearance or disappearance must not move the timecode or other
buttons. Do not vertically center or redistribute the group when its contents change. Do not
reserve an empty slot between the permanent controls, and do not show an always-present update
button merely to fill space. Manual checking remains available through the existing Settings path.

## Width and minimum height

Keep the control area as narrow as practical while showing the complete timecode and usable click
targets. Its width must not change with Dock height, transport state, update availability, download
progress, or toolbar visibility. Do not grow it horizontally as a fallback when vertical space is
insufficient: that would unexpectedly resize the user's panel area.

Use vertical space first. Reduce unnecessary padding and use icons before hiding functionality.
The approved design keeps timecode, transport, toolbar, and normal-window return accessible, with
room for the optional update control at the minimum supported height. Do not introduce a second
layout that moves controls beside transport or hides timecode at low heights.

The current 56 CSS px minimum may be raised. Exact width, button dimensions, spacing, and minimum
height must be selected from visual validation, not fixed speculatively in this document. Validate
the worst-case supported timecode, interface sizes, and text/display scaling. Width may be defined
through the existing interface-size system, but must remain stable within the selected size.

Review the effect of a new minimum on every Dock panel and on compact/standard/expanded height
thresholds. Keep frontend and native bounds consistent. Existing saved heights below the new
minimum are clamped when restored; document this visible migration. Do not reset panel ordering,
preferred widths, or unrelated geometry as part of that adjustment.

## Transport reuse

Extend the existing transport component with an explicit Dock presentation, placing timecode and
primary action on separate rows. Preserve its shared state model, timecode meaning and formatting,
Live/Stopped/Snapshot visual meaning, disabled states, and business callbacks.

Omit the redundant fixed LIVE source label in Dock. This does not change Dock's supported source
mode or introduce a source selector. Do not reduce the component to an independent Start/Stop
toggle that loses Snapshot behavior or duplicates transport logic.

Remove the centered transport pill from the expanded Dock toolbar once the persistent transport is
present. Reflow the remaining toolbar tools without retaining an empty central gap. There must be
only one transport control in Dock, not competing copies in the strip and toolbar.

## Toolbar and return action

The toolbar button continues to toggle the existing accessory toolbar. Preserve its open state,
directional arrow, editor behavior, keyboard access, and existing dismissal rules.

The return button invokes the existing normal-window restoration action. Restore the previous
window geometry and attributes without stopping capture, clearing history, or changing workspace.
Preserve any existing operation guards; the new button must not bypass business functions.

Keep device, profile, panel configuration, presets, and other less frequent controls in the toolbar.
This change is not a redesign of those editors.

## Update indicator and details

Surface the shared application update state in Dock:

- Update available: show an update/download icon with a tooltip identifying the available update.
- Downloading: show a suitable progress/busy presentation within the same fixed footprint.
- Ready: show that the update is downloaded and ready to install.
- Actionable failure: expose the relevant failure/retry information through the shared details
  surface without inventing a separate Dock retry policy.
- No relevant update state: hide the update control.

Do not flash, steal focus, or open a modal automatically when a background check or download
completes during a Dock session. State changes cannot move the other controls or resize the strip.
Use accessible labels and icon changes so color alone is not the only status distinction.

Clicking the indicator opens an independent accessory details window beside Dock. It does not
return the main application to normal mode. Reuse the current changelog-bearing update-details
content and available update actions, extended for staged downloads by the update-preferences work.
Closing the details leaves Dock active and does not stop capture or alter measurement history.

The details window is a presentation of the existing update controller. It must not perform its own
independent checks, own a second download, or hold an unrelated installation state machine. Requests
are routed through the application's existing business functions and native update coordination.
Freeze the displayed version and corresponding install target for an open details view.

Installation requires an explicit action. Preserve blocking-editor checks, multi-instance
coordination, progress handling, and platform restrictions. Portable copies route to the Portable
download rather than invoking an installer. Preview builds do not show unavailable updater controls.

The update-preferences design's next-launch offer must also be visible when restoring a Dock
session; use this details surface rather than a dialog clipped inside the narrow strip. Its
Update and Restart / Skip This Time behavior remains unchanged. This launch-time offer is distinct
from a background update notification, which never opens the details automatically.

Keep the details window inside the available display work area for either Dock edge. Define and
verify focus, Escape/close behavior, toolbar/editor coexistence, and safe dismissal during an
installation. Do not allow closing a presentation window to cancel or duplicate an installation
that has already begun. Exact window geometry is an implementation validation item.

## Implementation boundaries

- Reuse components with presentation variants and existing action entry points. Do not duplicate
  transport, update, persistence, or normal-window restoration logic.
- Respect Dock accessory state publication and action-routing conventions.
- Visual dimensions are CSS px; pass the correct webviewScale across native geometry boundaries.
- Update calculations that currently assume the 20px toolbar strip, including panel viewport and
  recording-indicator placement, without overlapping controls or shrinking their hit targets.
- Preserve normal-window transport presentation and behavior.
- If a new draft/preview/save/cancel editor is introduced, register it as a blocking editor. The
  update-details viewer itself is not a new settings editor.

## Validation and acceptance

1. Timecode and primary transport action are visible without expanding the toolbar, with all
   existing Live/Stopped/Snapshot actions and disabled states preserved.
2. The toolbar no longer contains a duplicate transport pill or an unused central spacer layout.
3. Control order matches the agreed vertical order at both Dock edges.
4. Height changes never widen the control area. Update state changes never shift permanent
   controls, resize panels, or change stored preferred panel widths.
5. Return, toolbar, and update icon buttons have clear tooltips, accessible names, focus indication,
   and usable targets. Transport is understandable in its compact presentation.
6. The chosen minimum height accommodates the complete control stack when an update is present.
   Existing shorter saved heights restore consistently with native bounds.
7. Check all relevant panels, longest supported timecodes, interface sizes, Windows text scaling,
   display DPI, top/bottom Dock, and macOS geometry. Controls and timecode must not clip.
8. Returning to normal mode restores geometry and attributes while capture and history continue.
9. Available/downloading/ready/error states use shared update data; ordinary background changes
   do not open details or interrupt work.
10. Details opens in its own correctly positioned window, stays tied to the selected update, and
    closes back to Dock. Repeated clicks cannot create conflicting update tasks or dialogs.
11. A pending-update startup offer is accessible when booting into Dock, with explicit install and
    skip semantics. Active peers and blocking editors receive the existing protections.
12. Verify Portable/Preview restrictions and existing normal-window update behavior.

Compare Agent Control screenshots before and after rendering changes, including the narrowest
supported layout and update-present state. Component tests cannot validate compositing, actual
window placement, or click-target appearance. Use appropriate frontend/native and documentation
checks for implementation scope.

## Documentation and related design

Update the matching user-guide chapter in the implementation commit, including the revised minimum
height and restored-height migration if applicable. Update living architecture documentation for
durable accessory-window behavior; living documents must not link to this historical spec.

Related active design: [Update Preferences and Deferred Installation](2026-10-16-update-preferences-design.md).

Current implementation references: `src/dock/DockStrip.jsx`, `DockToolbarToggle.jsx`, `dockSizing.js`,
`dockTokens.css`, `accessories/DockHeader.jsx`, `DockAccessoriesContext.jsx`,
`src/components/SourceTransportCluster.jsx`, and `src/components/AppSettingsOverlays.jsx`.
