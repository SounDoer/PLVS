# Panel Instance Workspace - Modules as Panel Management

**Date:** 2026-06-20
**Status:** Draft

## Summary

Upgrade the workspace from "one visible module per module type" to "any number
of panel instances, each backed by a module type." The toolbar button and tooltip
remain `Modules`. The `Modules` popover becomes the management surface for the
current workspace:

```txt
Modules

Level Meter        [rename] [trash]
Loudness           [rename] [trash]
Spectrum 1         [rename] [trash]
Spectrum 2         [rename] [trash]

[+ Add Panel v]
```

There are no `Current` or `Add` section labels in the popover. The current panel
list appears first; the `+ Add Panel` control sits below it.

This is a framework-level workspace change. It is not a Level Meter special case.

## Motivation

The current workspace assumes module type and panel identity are the same thing.
That makes duplicate panels impossible: there can be only one `peak`, one
`spectrum`, one `vectorscope`, etc.

The Level Meter work makes this limitation more visible, but the need is broader:

- two Level Meter panels with different future settings;
- two Spectrum panels;
- two Vectorscope panels;
- future panel variants that share a renderer but need separate placement.

The durable model is:

```txt
panel instance -> module type + optional custom title + layout position
```

## Current Model

Current workspace state uses module ids directly as tab ids:

```txt
tree.leaf.tabs: ModuleId[]
tree.leaf.activeTab: ModuleId
visibleModules: ModuleId[]
fullscreenId: ModuleId | null
panelControls: global panel controls
```

`Modules` is therefore a visibility manager. Hiding a module removes it from
rendering while preserving tree shape. Showing it again reactivates the same
module id.

That model breaks down once duplicate panel instances are allowed:

```txt
hide Spectrum = which Spectrum?
click Spectrum again = restore old Spectrum or create a new one?
```

The new model removes display/hide as the main concept. Users add panel
instances and delete panel instances.

## Target Model

Introduce stable panel instance ids:

```txt
PanelId = string

PanelInstance = {
  id: PanelId,
  moduleId: ModuleId,
  customTitle?: string,
  config?: object
}

WorkspaceState = {
  tree: TreeNode<PanelId> | null,
  panelsById: Record<PanelId, PanelInstance>,
  panelOrder: PanelId[],
  fullscreenId: PanelId | null,
  panelControls: ...
}
```

The tree stores panel ids, not module ids. The registry remains keyed by module
id and provides the component, icon, default title, and min size.

No migration is required for this slice. The app may reset to the new default
workspace shape in development.

## Modules Popover

The toolbar button remains:

```txt
Modules
```

The tooltip remains:

```txt
Modules
```

The popover title remains:

```txt
Modules
```

The body has two parts:

1. Direct list of current panel instances.
2. Bottom `+ Add Panel` dropdown/control.

Do not render `Current` or `Add` section headers.

### Current Panel Rows

Each row represents one panel instance and shows:

- resolved panel display name;
- rename icon/button;
- delete icon/button.

Delete removes that panel instance from:

- `tree`;
- `panelsById`;
- `panelOrder`;
- fullscreen state if it is currently fullscreen.

Clicking the row itself does not need to focus the panel in v1. The row is a
management item, not a navigation item.

### Add Panel Control

The `+ Add Panel` control sits below the current panel list.

Selecting a module type creates a new panel instance and inserts it into the
workspace. v1 placement rule:

```txt
insert new panel to the right of the root
```

If the workspace is empty, the new panel becomes the root leaf.

The add choices use registry titles, so the `peak` module appears as
`Level Meter`.

## Removing Panels

There are two deletion surfaces:

- panel header `X`: delete this panel instance, or all instances in that tab
  group for the existing leaf-level close action;
- `Modules` popover row trash: delete that panel instance.

There is no hidden-but-still-existing state in v1.

Removing the final panel shows the existing empty workspace state:

```txt
No panels
```

The `Modules` popover still exposes `+ Add Panel`, so users can rebuild the
workspace from empty.

## Naming

The same display name must be used everywhere:

- panel tab/title in the workspace;
- `Modules` row;
- fullscreen title;
- drag preview;
- preset restore.

### Automatic Names

Automatic names come from the module registry title.

When only one unnamed instance of a module type exists:

```txt
Spectrum
```

When multiple unnamed instances of a module type exist:

```txt
Spectrum 1
Spectrum 2
```

If an instance has a custom title, it displays the custom title and does not
participate in automatic numbering. Automatic numbering is computed among
unnamed instances only.

Example:

```txt
Spectrum 1
Dialogue Spectrum
Spectrum 2
```

If one unnamed instance remains, it may display the bare registry title again.
Automatic names are labels, not stable identities.

### Custom Names

Users can rename panel instances from the `Modules` popover.

Rules:

- custom titles are stored as `panelsById[id].customTitle`;
- leading/trailing whitespace is trimmed;
- empty input clears the custom title and restores the automatic name;
- duplicate custom titles are allowed;
- panel titles are not directly editable in the workspace header in v1.

The row-level rename interaction should match the existing preset rename style
where practical: edit icon enters inline edit mode, check confirms, X cancels.

## Presets

Presets capture and restore the full instance workspace:

```txt
tree
panelsById
panelOrder
panelControls
windowBounds?
windowPinned?
focusView?
```

Applying a preset restores panel instance ids, custom titles, and layout exactly.

Manual instance edits clear `presetsStore.activeId`:

- add panel;
- remove panel;
- rename panel;
- move tab;
- resize split;
- change panel controls.

## Panel Controls

The first implementation may keep existing `panelControls` global. That means
two Spectrum panels share channel/view controls, and two Level Meter panels share
`levelMeterMode`.

This is acceptable for the workspace model slice. Per-instance controls are a
follow-up:

```txt
panelsById[id].config = {
  levelMeterMode,
  spectrumChannel,
  vectorscopePair,
  ...
}
```

Do not block the workspace model on per-instance controls.

## Out of Scope

- Migration from old persisted workspace or old presets.
- Per-instance panel controls.
- Direct title editing in panel headers.
- Duplicate-panel-with-same-config command.
- Reordering panel rows in the `Modules` popover.
- Changing the toolbar button or tooltip away from `Modules`.
- Building additional Level Meter metrics.

## Testing Notes

- Reducer tests cover adding two instances of the same module.
- Reducer tests cover removing one duplicate without removing the other.
- Reducer tests cover renaming and clearing a custom title.
- Reducer tests cover removing the fullscreen panel.
- Rendering tests cover automatic names and custom names.
- Toolbar/popover tests cover current panel rows, trash, rename, and bottom
  `+ Add Panel`.
- Preset tests cover saving/applying `panelsById`, `panelOrder`, and
  `customTitle`.
