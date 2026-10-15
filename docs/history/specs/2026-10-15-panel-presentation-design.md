# Unified panel presentation

Date: 2026-10-15
Status: Implemented in the working tree; automated and native verification completed, awaiting user review.
Branch: `codex/dock-flexibility`

## Problem and decisions

Workspace currently offers Compact Panels, while Dock hardcodes absent panel headers and numeric
axis rails but retains several channel labels. Users cannot choose the same presentation in both
surfaces. The intended change makes presentation explicit without creating another panel implementation.

Workspace Views contains two independent switches, in this order:

1. **Hide Panel Headers** (replaces Compact Panels).
2. **Hide Axes & Labels** (new).

Dock Views contains only Hide Axes & Labels. Dock has no Panel Header and will not gain one.
Unification means shared semantics for applicable controls, not identical panel shells or menus.

Do not introduce display presets, a combined dropdown, per-panel overrides, extra tooltips, or a
separate compact typography scheme. All visual sizes continue to follow Interface Size.

| Surface | Hide Panel Headers default | Hide Axes & Labels default |
| --- | --- | --- |
| Workspace | Off | Off |
| Dock | Not applicable; no Panel Header | Off |

Each surface remembers its axes/labels preference independently; header visibility is Workspace-only.
Views edits the current surface. Changing
surface selects its saved values; it never copies, resets, or overwrites the other surface's values.
Defaults apply to absent preferences, not on every Dock entry. Top and Bottom share Dock preferences.

## Terminology and visibility contract

**Panel Header** means the entire panel-top region containing its title, tabs where supported,
and panel actions. Use this term in code, UI, comments and documentation. It is distinct from the
application toolbar, native window chrome, and the Dock accessory toolbar (currently named DockHeader).
Do not mechanically rename unrelated uses of header or compact.

**Axes & Labels** means chart axis rails/scales and chart identity labels. Hide them together and
reclaim their layout space. This is a presentation option, not a change to axis ranges or analysis.

| Element | Hidden by Hide Axes & Labels |
| --- | --- |
| X/Y numeric axis scales, their rails and dedicated interaction strips | Yes |
| Channel/pair labels, including L/R and custom channel names | Yes |
| Level Meter M/ST mode labels | Yes, exactly like channel labels |
| Vector correlation numbers -1, 0, +1 and their label row | Yes |
| Live meter readings, playback maxima and TP Max reading/marker | No |
| Stats metric names, values and units | No |
| Hover readouts, Spectrum peak readouts, Snapshot state and empty/error messages | No |
| Plot grid, Polar outline, Lissajous reference lines | No; existing grid policy still applies |
| Correlation track, endpoints, zero reference and moving indicator | No |

Any axis title introduced later follows its axis visibility. Hiding labels deliberately sacrifices
channel/mode identification, including multichannel identification; do not add M/ST exceptions or
force labels back at particular sizes. Accessibility names for controls remain intact.

## Panel coverage

- Level Meter: hide vertical bottom and horizontal left label rails, including M/ST. Numeric axes
  follow the same switch. TP Max and channel readings stay visible and aligned to actual bars.
- Loudness: show/hide its normal time and level axes; no Dock-only scalar summary is reintroduced.
- Spectrum: show/hide its normal frequency and level axes. Existing grid, hover, peak labels,
  Snapshot entry and return-to-Live behavior remain available.
- Spectrogram: apply the policy to chart scales/labels in both heatmap and 3D paths; keep geometry,
  grid settings and 3D availability independent of presentation.
- Waveform: control both normal axes and channel labels without removing waveform data/overlays.
- Stereo Map: control normal axes and Position channel labels. Do not invent channel labels for
  modes that do not represent channels spatially.
- Vector: control pair labels in every mode and correlation numbers. Retain aspect ratios and
  centered instrument layout. Fit geometry using only the rows that are actually visible.
- Stats: metric content is unaffected; its Workspace Panel Header follows the header switch.

## Panel headers and access

Workspace retains existing header actions, tabs and context-menu access when headers are hidden.
Fullscreen must use the same explicit header policy rather than silently forcing a header.

Dock retains its headerless panels and existing module/settings editor access. Do not add per-panel
titles, actions, tabs, or a hidden/disabled Hide Panel Headers switch to Dock.

## Dock toolbar organization

Add **Device** and **Views** entries to the Dock accessory toolbar, using the existing accessory
editor window for their content so popovers are not clipped by the narrow toolbar window.

- Device reuses the normal Device selection/settings capabilities applicable to live Dock capture.
  It reads and changes the same application device state through existing business functions; it
  does not introduce Dock-specific device preferences or a second capture owner. Entering/exiting
  Dock or merely opening Device must not reselect a device or restart capture. Explicit changes
  follow the normal capture transition and error behavior.
- Views contains Hide Axes & Labels, then a Dock selector with Off / Top / Bottom, then Reserve
  Space. Off performs the existing restore-window action; Top/Bottom use the existing edge action.
  Reserve Space uses the existing reservation action and platform capability rules.
- Remove the standalone Reserve Space, Dock to Top/Bottom and Restore toolbar buttons once their
  operations are available in Views. Retain the other toolbar functions, including transport,
  panel management, Loudness Profile and Presets.
- Reuse applicable controls and their meanings from Workspace Views, without copying unsupported
  window controls. Workspace keeps its existing Views controls plus the two presentation switches.
  Dock does not expose Hide Panel Headers.

The main React root owns mutations and persistence; accessory windows render snapshots and
dispatch validated actions. Selecting Dock Off restores Workspace presentation preferences and
closes the Dock accessory UI through the existing exit lifecycle. Changing edge or Reserve Space
does not reset panel presentation, devices, layouts or Snapshot state.

Hiding headers must not remove access to Views, panel settings, or restoring the window. Opening
Views/Device/settings must participate in existing accessory visibility management. Do not revive the
Snapshot/Go Live toolbar sticking or stopped-transport flash bugs.

## Layout and interaction

Workspace's two switches work in all four combinations; Dock supports both annotation states.
Workspace header visibility must not implicitly control
axis visibility, chart padding, font size, minimum plot height, or analysis settings. In particular,
remove the existing Vector dependency on the ambiguous compact prop for minimum-height behavior;
Dock sizing constraints belong to the surface/container.

Showing annotations in Dock renders the same rails and interactions as Workspace. Hidden axis
strips are not invisible hit targets. Existing plot gestures continue; ranges remain adjustable
through available settings and linked viewport controls. Presentation changes do not reset history,
Snapshot selection, time/frequency ranges, channel selection, Max Hold, or panel controls.

Showing axes does not automatically change Dock height, saved widths, or edge. At low
height, budget label/marker rows before plot space; clamp plot geometry to nonnegative sizes.
Use existing scrolling/clipping rules and keep controls usable. Do not silently override switches
at low height. Validate 56 px explicitly; a very small plot is an accepted result of choosing more
chrome in a small container, not a reason for overlapping labels or controls.

Vector minimum width must depend on visible content. The numeric tick readability floor applies
only with annotations visible. Dock has no header-action width floor. Derive the hidden
case from remaining instrument/interaction requirements and shared spacing, with native screenshot
evidence before selecting a numeric floor. Do not force plot width to track height or rewrite saved
widths on toggle. Keep current resize/reset behavior and unrelated panel width policies.

## State, persistence and compatibility

Use one normalized panel-presentation model with Workspace-only `hidePanelHeaders` and separately
stored `hideAxesAndLabels` booleans for `workspace` and `dock`. Proposed canonical View field:

```json
{
  "panelPresentation": {
    "workspace": { "hidePanelHeaders": false, "hideAxesAndLabels": false },
    "dock": { "hideAxesAndLabels": false }
  }
}
```

Persist through the existing settings owner and subscriptions. Keep other Focus View fields and
native window behavior unchanged. Explicit valid new fields win; missing workspace header state
migrates from legacy `focusView.compactPanels`. Missing axes state and Dock state use the defaults
above. Both surfaces show annotations by default. Normalize per field and preserve
explicit boolean values. New internal components use panel-header/presentation terminology.
Do not persist or advertise a Dock header preference; strict public patches reject that unsupported
field. The earlier draft's two-switch Dock model was never implemented and needs no migration.

Retain legacy `compactPanels` only at compatibility boundaries, derived from workspace header
visibility rather than independently stored mutable state. Existing Agent Control clients may
read/write that alias for Workspace. Reject conflicting old/new values in one request atomically.
Expose the canonical two-surface state with explicit targeting; never make a remote update depend
on whichever surface happens to be active when the request executes.

Presets capture presentation choices. Applying a workspace preset restores Workspace presentation
without overwriting the inactive Dock preference; a Dock-enabled preset restores both captured
surfaces. This preserves the existing principle that dock-disabled presets do not overwrite hidden
Dock configuration. Legacy presets use the migration above. Portable export/import must carry the
new state without silently dropping it; follow the existing pack-version rules when extending its
strict schema, and continue accepting existing supported packs. Sharesets preview uses the captured
Workspace policy without relying on live application settings.

Agent Control schema, inspect/read/patch/reset mapping, capabilities, revision settlement, validation,
generated reference and contract tests must evolve together. Generate reference files with the
repository command; do not edit them by hand. All mutation entry points call the same business
functions. Existing blocking-editor and preset refusal behavior must remain intact.

## Acceptance and non-goals

Accept when all panels honor Workspace's four combinations and Dock's two annotation states;
defaults, migration, restart persistence and preset/portable round trips are verified; Dock Device
and Views are reachable; edge, reservation and restore work from Views; hidden rails
leave no blank space or hit targets; measurement behavior and Snapshot interactions are unchanged.
Compare before/after native Agent Control screenshots using repeatable data at normal/low heights
and multiple Interface Sizes. Cover Top and Bottom, stopped and live, and both Level Meter orientations.

No implementation, commit, new worktree, release or website publication is authorized by this
document-writing task. Implementation will update living documentation with the code. This is a
design record, not a claim that current product behavior already matches it.


## Approved follow-up: Dock frequency linking

Dock Spectrum, Spectrogram and Stereo Map now join the Workspace frequency viewport by default.
The existing range-row link control governs membership; unlink copies the visible range, relink
adopts the shared range. Hidden annotations do not change membership. Stored local ranges remain
available for independent use. Agent Control and portable Presets expose the membership alongside
local ranges. A Workspace join must respect members in the Dock even when its window is inactive.
