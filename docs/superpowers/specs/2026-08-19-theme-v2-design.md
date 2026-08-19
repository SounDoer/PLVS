# Theme V2 — Design

**Date:** 2026-08-19  
**Status:** Implemented; final native desktop visual acceptance pending
**Supersedes:** `docs/working/superpowers/specs/2026-06-20-custom-themes-design.md` where the two conflict  
**Related:** `docs/adr/0002-theme-id-and-appearance.md`, `docs/design-tokens.md`,
`docs/working/design/theme-v2-color-inventory.md`

## Summary

Replace the current seed-and-semantic-field custom-theme editor with a role-based system that is
simple at first contact and complete when expanded.

A theme author normally chooses six Core Colors and three purpose-specific Palettes. A pure Theme
Compiler derives every concrete interface, data-visualization, effect, and native-window color from
that intent. Advanced controls allow meaningful leaf roles to deviate without exposing raw CSS
variables or Canvas implementation details.

The real PLVS interface is the live preview. Draft edits remain in memory until Save, and the same
resolved theme is published to DOM, SVG, Canvas, Dock/accessory windows, and native consumers.

## Problem

The current editor exposes five seeds and the complete shadcn semantic shell. This has two problems:

- names such as `accent`, `cardForeground`, and `popover` describe implementation rather than what a
  PLVS user is changing;
- seeds are concise but hide their consequences, while a flat list of every output color is complete
  but fragmented and easy to make inconsistent.

Theme V2 must give a beginner a small, understandable set of decisions without preventing an expert
from controlling a specific meaningful color.

## Product principles

1. **Name intent, not implementation.** The editor says where a color is used; it does not expose CSS
   token names, React component names, or Canvas APIs.
2. **Simple by default, complete on demand.** Core Colors and Palettes produce a complete theme;
   Advanced stores only deliberate deviations.
3. **One visible color contract.** Every intentional visible color is core intent, palette intent, a
   linked role, an automatic derivation, an internal effect, a safety fallback, or an asset.
4. **Share mechanisms without erasing semantics.** Status, intensity, and frequency all use color
   collections, but they retain different editing and rendering rules.
5. **Live means the real product.** PLVS itself previews the draft; the editor does not reproduce
   miniature fake charts.
6. **Preserve identity before state.** A data series first has an identity, then a display state, then
   an optional semantic-status treatment.
7. **Migration preserves appearance, not guessed intent.** V1 themes remain visually stable even when
   that requires explicit V2 overrides.

## User-facing model

### Core Colors

The Core page exposes six opaque colors:

| Role             | Intent                          | Representative uses                                                      |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------ |
| Workspace        | Lowest application layer        | App background, empty workspace gaps, Dock base                          |
| Surface          | Content-bearing interface layer | Panels, header, footer, settings, dialogs, popovers, controls            |
| Text             | Neutral readable content        | Primary text and derived secondary, annotation, muted, and disabled text |
| Interface Accent | Interaction emphasis            | Primary buttons, selected tabs, toggles, focus rings, active splitters   |
| Primary Data     | Main measurement identity       | Primary traces, classic Waveform, Vectorscope, primary Stereo Map data   |
| Secondary Data   | Comparison identity             | Secondary Spectrum and Stereo Map data, future comparisons               |

Interface Accent and Primary Data are independent roles. Builtin themes may intentionally give them
the same value, but changing either one never changes the other implicitly.

Core colors are opaque. Transparency belongs to effects rather than to the identity color.

### Palettes

The Palettes page contains three groups under one visual framework while preserving their distinct
meaning.

#### Status Palette

Three opaque semantic anchors:

- Good
- Warning
- Critical

They color discrete states and may also form a continuous meter gradient. Thresholds remain product
or panel settings; they are not theme data. Status colors are never derived from Interface Accent.

#### Intensity Palette

An ordered stop list for Spectrogram magnitude or density. The editor shows a gradient strip and
supports presets. A custom palette:

- contains at least two stops;
- keeps endpoints at 0% and 100%;
- allows intermediate stops to be added, removed, recolored, and repositioned;
- interpolates into the renderer's lookup table.

Initial builtin presets should be a small, reliable set such as Inferno, Viridis, Magma, and
Monochrome. A saved theme owns a snapshot of its stops plus optional preset provenance, so an app
update cannot silently recolor it.

#### Frequency Palette

Three opaque hue anchors for spectral Waveform rendering:

- Low
- Mid
- High

This is not a generic stop list. The user's panel-level split frequencies define where the anchors
apply, log-frequency interpolation produces the hue, and tonality blends that hue toward an
automatically derived Neutral. Centroid is a related overlay role, not a fourth frequency band.

The first release keeps Low/Mid/High fixed in structure and offers a small set of presets.

### Automatic roles

The compiler turns authoring intent into opaque, concrete leaf colors. Expected role families
include:

- surface levels such as panel, raised, control, muted, and hover;
- text levels such as primary, secondary, data annotation, muted, disabled, content on accent, and
  content on critical;
- interaction states such as focus, selection, and active splitter;
- data relatives such as companion, snapshot, hold, selection, and fill;
- associated visualization roles such as Waveform Neutral and Centroid;
- effects such as border, scrim, glow, highlight, and shadow.

Text hierarchy is compiled into final opaque colors against its target surface. Components do not
render the base Text color with arbitrary local opacity. Effects store or derive opacity separately
from their source color.

Derivation uses perceptual color math, preferably OKLCH with linear-RGB compositing where required.
It preserves identity hue where practical and uses conservative differences by default. Exact
recipes and constants are implementation details covered by compiler tests and builtin-theme
goldens.

### Data identity and state

The default mapping is:

- Primary Data: Loudness Momentary, Spectrum A, Vectorscope, primary Stereo Map, classic Waveform,
  and sample peak markers;
- Companion of Primary: Loudness Short-term and other equal-family variants;
- Secondary Data: Spectrum B, secondary Stereo Map, and future comparisons;
- Status Palette: rule-driven safe, warning, or critical treatment.

Snapshot, Hold, Selection, and Fill are display states rather than new core identities. Recipes may
use opacity, lightness, chroma, width, dash, or markers so state remains distinguishable without
needlessly changing series identity.

Resolution order is:

```text
identity -> display state -> semantic status
```

### Advanced

Advanced exposes every color role with independent visual meaning, but not every intermediate value
or source-code color expression. It uses a curated, module-first hierarchy:

```text
Advanced
├─ Interface
│  ├─ Text
│  ├─ Surfaces
│  └─ Interaction
├─ Loudness
├─ Spectrum
├─ Waveform
├─ Vectorscope
├─ Stereo Map
└─ Shared Effects
```

Text and surface leaf roles initially support:

- Auto
- Custom

Compatible data roles may additionally support:

- Follow Primary
- Follow Secondary

References are type-compatible and registry-defined. The editor does not offer an arbitrary color
dependency graph. Resetting a role to Auto removes its stored override.

The exact Advanced role list is not locked by this document. The Color Inventory must establish it
from all visible PLVS states before implementation planning.

## Editor experience

### Container and navigation

The editor remains a floating, draggable, non-modal panel with full-app live preview. It contains:

- a header with theme name and Undo/Redo;
- Core, Palettes, and Advanced pages;
- a scrollable content region;
- Cancel and Save actions.

The panel is clamped to the available window and remains usable across supported interface sizes.
Its exact width and responsive breakpoints are implementation tuning, not theme data.

There is no dimming overlay, synthetic theme preview, affected-component hover highlight, Theme
Health panel, or stable-color editor exception. The editor uses the draft theme like the rest of the
application. Ordinary Undo and Cancel provide recovery from an unreadable experiment.

Local palette feedback is limited to what editing requires:

- three swatches for Status;
- a gradient strip for Intensity;
- a Low/Mid/High strip for Frequency.

If the user wants to inspect a real instrument, they open that instrument in PLVS.

### Color control

The common color control provides:

- a visual color field and hue control;
- Hex as the default text representation;
- accepted pasted RGB or OKLCH values, normalized after commit;
- session-local recent colors;
- incomplete text editing without committing an invalid intermediate value.

Core colors and palette anchors have no alpha control. Advanced effects that support transparency
show source color and opacity as separate concepts.

Picker movement is coalesced to at most one draft publication per animation frame. One continuous
drag creates one Undo entry rather than one entry per pointer event.

### Theme picker and lifecycle

The Theme Picker is a popover/list with Built-in and Custom sections. Each row shows a compact theme
swatch and selection state. Inline actions reuse existing PLVS components and icon semantics:

- Pencil for Edit;
- Copy for Duplicate or Customize;
- Trash2 plus the existing inline confirmation for Delete;
- the existing add affordance for creation.

Every icon has a tooltip and `aria-label`; activating it does not also select the row.

Builtin themes are immutable. Users may select or Customize them. Custom themes may be selected,
edited, duplicated, or deleted. Customize and Duplicate share one draft-creation primitive.

Creating from System captures the currently resolved appearance. Saving switches Appearance to
Fixed and selects the new custom theme; cancelling restores System. A custom theme's `colorScheme`
is inherited from its source or currently resolved system theme and remains internal, not editable.

New themes exist only as in-memory drafts until Save. Names are trimmed, non-empty, length-limited,
and generated from the source when necessary, for example `Dark Copy`, `Ocean Copy`, or
`Ocean Copy 2`. Stable IDs, not names, establish identity.

Deleting the active custom theme falls back to the matching builtin for its stored color scheme.

Reset language remains specific:

- Undo / Redo for draft history;
- Revert Changes for the complete open-session draft;
- Reset Overrides to Auto;
- Reset Palette to Preset.

## Authoring and resolved data

Theme V2 separates user-authored intent from renderer-ready output.

An illustrative authoring shape is:

```js
{
  version: 2,
  id,
  name,
  colorScheme,
  core: {
    workspace,
    surface,
    text,
    interfaceAccent,
    primaryData,
    secondaryData,
  },
  palettes: {
    status: { good, warning, critical },
    intensity: { presetId, stops },
    frequency: { presetId, low, mid, high },
  },
  overrides: {
    // roleId: { kind: "color", value: "#..." }
    // roleId: { kind: "reference", source: "core.secondaryData" }
  },
}
```

This shape is directional, not a final field-level contract. The inventory and implementation plan
may refine names, but must preserve the separation of core intent, palette intent, and sparse
overrides.

The resolved theme is complete and ephemeral. It includes:

- all registered leaf colors and effect values;
- the CSS-variable binding map;
- Canvas colors and palette lookup inputs;
- the native color scheme;
- identity and revision metadata.

Derived output is not persisted as user intent.

## Role Registry and Theme Compiler

The Theme Role Registry is the authoritative wiring map for visible color. Each role defines, as
applicable:

- stable role ID;
- user-facing label and usage description;
- family and value kind;
- default source and derivation recipe;
- allowed override modes and compatible references;
- CSS, Canvas, or native bindings.

The registry contains both shared roles and meaningful component leaf roles. It validates unique
IDs, valid dependencies, compatible references, known recipes, complete bindings, and absence of
cycles. Editor layout is curated rather than blindly generated from registry order.

The Theme Compiler is a pure function with no React, DOM, Store, Canvas, or Tauri dependency:

```text
Authoring Theme + Role Registry -> Resolved Theme
```

CSS variable names are an output bridge, not the authoring schema. Canvas receives resolved colors
and palettes directly rather than parsing computed CSS where practical.

## Runtime publication

A central Theme Runtime owns active and draft publication:

```text
selected theme or editor draft
            ↓
       Theme Compiler
            ↓
       Resolved Theme
       ↙      ↓      ↘
 CSS / SVG   Canvas   Native and accessory windows
```

Theme ID identifies a saved theme. Revision identifies content changes, including repeated draft
changes under the same ID.

- DOM and SVG consume CSS bindings and repaint through browser style updates.
- Canvas consumers receive the exact resolved roles they use and redraw when those values change.
- Expensive lookup tables are rebuilt only when their palette inputs change.
- Native consumers subscribe only to relevant resolved fields, normally `colorScheme`.
- Separate WebViews receive ordered ephemeral preview snapshots and acknowledge readiness so a newly
  opened window receives the latest revision.

Draft publication is animation-frame-coalesced. No Store write occurs while dragging or otherwise
previewing. Save performs the persistence write; Cancel republishes the pre-editor resolved theme.

## Color scheme

`colorScheme` remains required internal metadata for browser-native controls, scrollbars, Glass,
tray resources, and matching fallback behavior. It does not claim that every custom color is
perceptually dark or light, and it is not a second theming axis.

The user does not edit it. A custom theme inherits it at creation. This preserves current behavior
and avoids pretending that PLVS can reliably infer an author's visual intent from arbitrary colors.

## Persistence and V1 migration

Runtime code has one versioned normalization boundary:

```text
raw persisted value -> version check -> V1-to-V2 migration -> V2 normalization
```

All code after that boundary consumes V2 only. V1 compatibility must not be scattered among
components or renderers.

Migration is deterministic and appearance-preserving:

1. Map old background, surface, text, seeds, status colors, and colormap into the closest V2 core or
   palette roles.
2. Resolve the V1 theme using a frozen V1 resolver.
3. Preserve remaining concrete V1 outputs as explicit Advanced overrides where automatic V2 output
   would differ visibly.
4. Normalize legacy alpha-bearing identity colors into valid opaque intent plus effect opacity where
   that mapping is unambiguous; otherwise preserve the rendered result through a leaf override.

Migration does not infer whether an old value was intentionally automatic. An optional future
action may let users adopt new automatic colors by deleting migrated overrides.

Builtin Dark and Light are re-expressed as V2 authoring themes before custom migration ships. Golden
tests compare their resolved outputs with the current builtins. Existing saved themes must not
visually change merely because PLVS upgraded.

## Validation

The first release validates structural correctness only. Save is blocked for conditions such as:

- invalid or missing required colors;
- malformed palettes or unordered stops;
- missing role references;
- incompatible reference kinds;
- dependency cycles;
- incomplete resolved output.

Low contrast, unconventional combinations, or unattractive themes are allowed. The product does not
score, warn about, or automatically repair aesthetic or accessibility choices in this release.

## Color Inventory requirement

Implementation planning starts only after a repository-wide Color Inventory. Every intentional
visible color across normal UI, visualizations, Dock, accessory windows, Glass, hover/focus/disabled
states, dialogs, snapshot/hold/selection states, and scheme-selected assets is classified as one of:

- Core;
- Palette;
- Linked;
- Auto;
- Customizable Override;
- Internal Effect;
- Safety Fallback;
- Asset.

The inventory combines static search, a fluorescent diagnostic theme, and state traversal. It must
also identify hardcoded colors, direct CSS color expressions, Canvas-only paths, unused tokens, and
fallbacks that should be unreachable for complete themes.

The goal is not to expose every computed RGB value. The goal is to ensure every intentional visible
color is controlled or derived by the theme contract.

## Explicitly out of scope

- Theme Health, health scores, contrast warnings, and automatic fixes;
- color-vision simulation;
- a special safe-color editor chrome;
- a miniature general-purpose preview inside the editor;
- hover-to-highlight affected components;
- arbitrary role dependency graphs;
- user-managed standalone palette-preset libraries;
- import, export, or community theme sharing;
- editable Core or Palette alpha;
- preventing low-contrast or aesthetically poor choices;
- user-editable `colorScheme`;
- layout, typography, panel opacity, Glass strength, data thresholds, or frequency splits as theme
  properties.

## Testing strategy

### Static contracts

- registry ID, dependency, recipe, reference, and binding integrity;
- hardcoded-color and unregistered-token scans with an explicit allowlist for fallbacks and assets;
- no manual dependencies on generated files.

### Compiler

- complete deterministic resolution for every builtin and representative custom theme;
- perceptual derivation and compositing fixtures;
- builtin Dark/Light golden output;
- override precedence, compatible references, cycle rejection, and palette interpolation.

### Runtime and consumers

- CSS/SVG semantic bindings;
- Canvas color updates under a stable theme ID and revision;
- no unrelated redraw or lookup-table rebuild when an irrelevant role changes;
- native consumers react only to relevant resolved fields;
- ordered cross-window draft propagation and ready handshake.

### Editor and persistence

- create, customize, edit, duplicate, rename, delete, Save, Cancel, Undo, and Redo;
- System creation and cancellation behavior;
- invalid intermediate color input and structural Save blocking;
- one drag gesture produces one Undo entry and no Store writes;
- V1 fixture migration and V2 round-trip normalization.

### Visual verification

- fluorescent diagnostic theme across supported modules and interaction states;
- Dark/Light baseline screenshots;
- representative custom themes in normal, Dock, and accessory windows;
- retained data recolors without requiring new audio frames.

`npm run check` is required before merge.

## Acceptance criteria

- A user can create a coherent theme by editing only six Core Colors and the palettes they care
  about.
- Interface Accent changes interactive UI without changing data identity; Primary Data changes the
  intended measurements without changing buttons or status semantics.
- Every intentional visible color found by the inventory is registered, derived, explicitly
  allowlisted as a fallback/asset, or removed as dead code.
- Advanced can override every registered role with independent visual meaning without exposing raw
  CSS or Canvas implementation names.
- DOM, SVG, Canvas, Dock/accessory windows, and relevant native surfaces agree on one resolved draft
  revision.
- Live preview writes nothing to persistence; Save persists once; Cancel restores the prior
  appearance, including System mode.
- Existing V1 custom themes migrate without an unintended visible change.
- Builtin themes remain immutable and visually equivalent through the V2 compiler.
- All structural validation and automated checks pass.

## Open implementation checkpoints

1. Freeze the V2 schema, provisional role IDs, palette preset IDs, recipes, Advanced labels, and
   “Used by” descriptions before V2 persistence is enabled.
2. Run the Color Inventory's diagnostic-theme traversal after all runtime consumers use Resolved
   Theme, adding any missing leaf role before final cleanup and merge.
3. Update the standard architecture and design-token documents after the delivered code replaces
   the V1 runtime.
