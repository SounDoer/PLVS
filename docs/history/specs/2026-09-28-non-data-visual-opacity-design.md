# Non-Data Visual Opacity

Date: 2026-09-28  
Status: Approved design; not implemented

## Context

The chart-data opacity audit is complete. The remaining UI uses transparency for unrelated jobs:
hover feedback, resize affordances, chart guides, disabled controls, empty tracks, overlays,
structural surfaces, text hierarchy, borders, shadows, status tints and animation. Those uses grew
independently, so equal meanings have different numbers and different meanings sometimes share one
opacity treatment.

The problem is not transparency itself. Some transparency carries real information, while some is
an accidental second attenuation applied to a Theme role that is already visually tuned. This
design separates those cases and makes Workspace and Dock follow the same visual language.

## Scope

In scope:

- Hover, focus, active, drag, resize and snap feedback.
- Timeline selection lines, hover crosshairs, off-screen edge hints and hover markers.
- Range and Switch tracks, Dock level bars and Vectorscope correlation rails.
- Inactive, disabled, unavailable and no-data states.
- Tooltips, popovers, menus, editors, dialogs, scrims and transient overlays.
- Workspace, normal panel, fullscreen, summary and Dock structural surfaces.
- Non-data text, icons, borders, dividers, shadows, glows and animation opacity.
- Live, Snapshot, Success, Warning, Danger and destructive UI states.

Out of scope:

- Measurement-data opacity already covered by the preceding chart-data audit: Spectrum fills,
  Stereo Map energy fade and fill, Waveform fill, Vectorscope persistence, Spectrogram alpha and
  other data rendering.
- Changing `surfaceOpacity` persistence, range or Agent Control semantics.
- Changing how `interface.border.default` derives its base hue. It remains an independent
  Interface role: neutral white in Dark, neutral black in Light, with an Advanced override.
- Audio, analysis, capture and native-window geometry.

## Principles

1. Theme owns color identity; product interaction owns state strength.
2. A component does not add opacity merely to create a new color hierarchy that the Theme already
   expresses with an opaque semantic role.
3. Structural Surface Opacity is applied once at a structural fill. It never weakens foreground
   content, borders, controls, state marks or measurement data.
4. Raised content surfaces are opaque. A scrim may be translucent; the readable surface above it
   is not.
5. Workspace and Dock share one rule whenever they express the same state. Geometry may differ
   where their physical affordances differ.
6. `--border` and `--input` are already compiler-owned color effects. Consumers use them directly
   instead of multiplying them by a local `/N` modifier.
7. Static hierarchy prefers opaque semantic colors. Transparency remains only where it directly
   describes interaction, a temporal transition, a veil, or a composited rendering effect.
8. Fewer named rules are better than many near-identical alpha values.

## Decision 1: Pointer, focus, drag and resize feedback

### Neutral hover

`muted/50` is the single neutral Hover and focus-within background for unfilled rows and controls.
The isolated `muted/34` and `muted/60` variants return to this rule unless the consumer is a filled
control whose own opaque color changes on Hover.

Two action-visibility behaviours stay distinct:

- Persistent panel-header actions are visible at 50% and become fully visible on Hover.
- Row-management actions are hidden until the row is hovered or contains keyboard focus.

The first preserves discoverability; the second avoids filling every management row with controls.

### Resize affordances

Workspace and Dock use the same color and state ladder:

- Idle visible line: `border`.
- Hover: `primary/70`.
- Active or keyboard focus: full `primary`.
- Workspace equal-split snap: full `primary`, without a glow.

The hit target and visible-line thickness may differ. Workspace has a wider resize hit area; Dock
has a compact line. The visible state color does not differ merely because the geometry does.

The unused `RESIZE_COL_CLASS` and `RESIZE_ROW_CLASS` glow recipes in `shellLayout.js` are removed.

### Drag targets

Workspace and Dock use a `primary/60` ring for a valid drag target. Workspace direction zones may
add a very light `primary/5` fill because the half-panel region communicates where the panel will
land. This is interaction feedback, not a surface hierarchy.

## Decision 2: Chart interaction guides

Committed selection and temporary inspection remain visually different:

| Meaning | Treatment |
| --- | --- |
| Committed time selection | Module Theme Selection color, full opacity |
| Hover crosshair | `muted-foreground/50`, dashed |
| Latest-window edge | Neutral guide treatment |
| Off-screen committed selection | Module Selection color, stronger edge plus a light directional wash |
| Hover point | Solid module color with a contrasting border, no glow |

Vertical and horizontal crosshairs use the same 50% strength. Loudness, Spectrum, Spectrogram,
Waveform and Stereo Map share one `ChartCrosshair` implementation; panels opt into the axes they
need and provide positions.

`TimelineLatestEdgeHint` and `TimelineSelectionEdgeHint` remain the shared owners of their edge
treatments. Their opacity numbers are named inside those shared components rather than copied into
panels.

The Spectrum hover-point glow is removed. Stereo Map does not gain one.

## Decision 3: Controls, tracks and measurement rails

- Range empty tracks use `input`, as today.
- Standard and compact Switches use `input` while unchecked, `primary` while checked, and an
  opaque thumb. The compact geometry remains, but Settings, Panel Settings and close confirmation
  share one compact style instead of three copies containing 80%, 85% and 95% values.
- Dock Level bars draw only the measured color fill. The empty portion exposes the Dock surface;
  it does not use `muted/40` or another track color.
- The Vectorscope correlation rail is not an input track. Workspace and Dock both use the Theme's
  `--ui-vectorscope-grid-stroke`, the existing Vectorscope Grid and Axes role.

When correlation has no valid measurement, the rail and `-1 / 0 / +1` coordinates remain visible
and only the marker is absent. No parent `opacity-30` is applied.

## Decision 4: Disabled, inactive, no-data and hidden states

These states are not interchangeable:

### Disabled

A disabled control is present but cannot be operated. The whole control, including its label when
the label belongs to that control, uses 50% opacity once. It also rejects pointer interaction and
uses the appropriate unavailable cursor. Local 30%, 40%, 60% and 70% disabled variants are removed.

### Inactive but selectable

An inactive item remains fully readable and clickable. The item itself is not faded. Selection
lists use:

- Active: solid `primary` marker.
- Inactive: opaque hollow marker in `muted-foreground`.

This applies to Source choices, Presets, Loudness Profiles, File Analysis History and comparable
selection indicators. Switches retain their own checked/unchecked language.

### No data

Static axes, labels and rails remain visible. The missing measured marker or value communicates no
data; the containing UI is not dimmed as if disabled.

### Intentional visibility states

Hover-only row actions, the 35% source tab being dragged, and resize handles that do not exist for
the current geometry retain their explicit visibility behaviour. These are not disabled styling.

## Decision 5: Scrims, overlays and inset surfaces

`SCRIM_CLASS` remains the only dimming veil: black at 60%. The File Drop overlay uses the same
scrim treatment, with an opaque prompt card above it.

Every readable raised surface is opaque:

- Tooltip, menu, popover, Panel Settings and Dock HUD: `popover`.
- Settings Drawer, editors and dialogs: the appropriate opaque `card` or raised semantic surface.
- Dock Editor Header: the same opaque raised-surface family as the Dock Editor.

The current `/85`, `/90` and `/95` surface alphas and their compensating backdrop blur are removed.

Inset areas do not create hierarchy by revealing the layer below. They use opaque Theme surfaces:

- Quiet inset: `muted`.
- Stronger neutral control or content area: `secondary`.
- Outer raised layer: `popover`.

This replaces Panel Settings `popover/35`, Update content `background/35`, Copyable Text
`muted/25` and comparable fixed-alpha inset fills.

## Decision 6: Structural Surface Opacity

The existing visible result stays:

| Boundary | Opaque source color before Surface Opacity |
| --- | --- |
| Workspace and fullscreen | `background` |
| Normal panels, shell header/footer, file summary | `card` |
| Dock shell | `popover` |

All structural boundaries consume the same user `--surface-opacity`. Borders, controls, text,
interaction marks and charts do not inherit it. Raised overlays and editors remain opaque.

The repeated `color-mix(... var(--surface-opacity), transparent)` expressions are replaced with
named shared structural-surface styles so a component selects its surface role rather than
rewriting the formula.

## Decision 7: Text and icon hierarchy

No new Subtle Text role is added in this change. The hierarchy is:

- `foreground`: titles, body copy, important values and primary actions.
- `muted-foreground`: descriptions, supporting labels, metadata and ordinary action icons.
- `--ui-text-annotation`: axes, units and compact chart annotations.
- Disabled: the whole control at 50%; this is a state, not a fourth text color.

Local `/25` through `/85` modifiers on non-data text and icons are removed. Action icons use
`muted-foreground` and become `foreground` on Hover. A drag handle is kept quiet through size and
Hover behaviour rather than 25% opacity. Select chevrons, help icons and close icons use their
semantic text color without a separate element opacity.

If the resulting Settings hierarchy proves too loud in visual review, a future design may add one
automatically derived, editor-hidden Subtle Text role. This design does not pre-emptively add it to
Advanced Interface.

## Decision 8: Borders and dividers

`border` is already a Theme color effect: the default is white at 9% in Dark and black at about 10%
in Light. Ordinary consumers use `border` directly.

- A real surface, section, control or module boundary uses `border`.
- A redundant boundary is removed rather than weakened to `border/30`.
- Settings footer punctuation separators become real short border dividers or spacing, not text at
  30% opacity.
- `input` is likewise consumed without an extra opacity modifier.

Interaction and state edges are separate: drag rings, selection hints and semantic error borders
may use their approved state treatment.

This work does not change the Border recipe. Core color changes within one scheme do not recolor
the neutral border automatically; an Advanced Interface Border Color override still does.

## Decision 9: Elevation and shadows

The current six-size shadow vocabulary is replaced at the product level with three elevation
states:

### Flat

No drop shadow:

- Workspace panels, Dock shell and modules.
- Header, Footer and File Analysis Summary.
- Inputs, Select triggers, buttons and Switch thumbs.
- Chart HUDs, ordinary cards and Settings groups.

These use Surface and Border to define their edges.

### Raised

One shared compact shadow:

- Tooltip, popover, dropdown and Panel Settings.
- Drag preview, toast and File Drop prompt.
- Auto-revealed Header/Footer overlays.

### Modal

One shared large shadow:

- Settings Drawer, editors, dialogs, Item Picker, Update, Crash Report and Theme Preview.

`Interface → Shadow Color` remains the Theme-owned color identity and Advanced override. Raised and
Modal strength and geometry are compiler/product-owned and adapt to Dark and Light; components do
not select `xs / sm / md / lg / xl / 2xl` or write shadow alpha.

The isolated `--ui-surface-highlight`, `--ui-surface-highlight-soft` and inset-highlight classes
are removed. The unthemed Tailwind `shadow-2xl` use is removed with the rest of the size ladder.

Contrast outlines for the color-picker pointer and Recording Indicator are not elevation and stay.

## Decision 10: Flat semantic status language

Colored translucent washes and decorative glows are removed from non-data status UI. There is no
shared 8%/10%/12%/15% fill ladder or 30%/40%/55% status-border ladder.

- Live and Snapshot use solid semantic dots/icons/text on a neutral opaque surface.
- Active source selection uses the normal opaque selected-surface language; its semantic icon or
  marker retains the Live/Snapshot color.
- Success, Warning and Danger badges use an opaque neutral surface with solid semantic icon/text.
- Warning and error notices use an opaque neutral surface plus a solid semantic accent edge/icon.
- Invalid controls use a solid semantic border rather than a translucent colored ring.
- A genuinely destructive primary action may use the full opaque Danger surface with its Theme
  on-Danger content color.
- Filled button Hover colors are opaque color mixes derived from the Theme role and foreground;
  `primary/90`, `secondary/80` and `destructive/80` do not make the button translucent.

The Live glow is removed; the solid dot may retain its reduced-motion-aware opacity pulse. The
Workspace snap glow is removed in favor of the full Primary snap line. Recording and color-picker
contrast outlines remain because they guarantee legibility rather than advertise status.

## Consistency contract

After implementation:

- Workspace and Dock use the same Hover, resize, disabled, inactive, no-data, correlation-rail,
  status and elevation semantics.
- Theme supplies opaque semantic colors plus its intentional Border, Input and Shadow effects.
- Only structural boundaries consume Surface Opacity.
- Raised and Modal surfaces are opaque.
- No ordinary border or input effect is attenuated a second time.
- No chart Hover marker or status UI relies on a decorative glow.
- Data rendering remains unchanged.

## Documentation and verification

Living design documentation must update with the implementation:

- `docs/design-tokens.md`: interaction strengths, track ownership, text roles, border consumption,
  flat status language and the Flat/Raised/Modal elevation model.
- `docs/architecture.md`: structural Surface Opacity and opaque Raised/Modal boundary, if its
  current wording or examples need adjustment after shared surface styles land.
- `docs/user/system-settings.md`: keep the user-facing Appearance description aligned if the
  visible Surface Opacity boundary needs clarification.

Verification covers Dark and Light, Surface Opacity 100% and a reduced value, normal Workspace,
Focus View, fullscreen, Dock, Dock Editor, menus, Settings, editors and dialogs. Automated
contracts protect shared class ownership; screenshot comparison confirms that removing tertiary
text alpha, status washes and flat-surface shadows does not erase hierarchy.

