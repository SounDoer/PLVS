# ADR 0005: Theme V2 authoring, compiler, and runtime

## Status

Accepted; implementation pending

## Context

PLVS currently stores each custom theme as a complete V1 snapshot:

```text
semantic shadcn fields + five seeds + spectrogram colormap + colorScheme
```

`applyThemeToDocument()` writes semantic CSS variables and `buildThemeTokens()` derives instrument
variables from the seeds. DOM and SVG consume those variables. Canvas renderers either read computed
CSS or look up the theme object independently, and native consumers receive selected fields such as
`colorScheme`.

This pipeline established useful separation between color and layout, but it is no longer an
adequate authoring model:

- seed names do not tell users where colors appear;
- one Accent seed controls both interface interaction and primary measurement data;
- exposing the complete shadcn semantic object is too low-level;
- some authoring fields are overwritten later in the apply pipeline;
- Canvas and cross-window consumers have no complete, typed resolved-theme contract;
- storing every concrete color cannot distinguish author intent from derived output;
- adding isolated component overrides to the V1 snapshot would create a second, permanent bridge
  layer.

The approved product model is defined in
`docs/superpowers/specs/2026-08-19-theme-v2-design.md`. The supporting source audit is
`docs/working/design/theme-v2-color-inventory.md`.

This ADR changes the color-theme pipeline only. Layout, typography, geometry, panel opacity, Glass
strength, measurement thresholds, and frequency split settings remain outside themes.

## Supersession

Where this ADR conflicts with earlier records, this ADR wins.

- It supersedes ADR 0001 Decisions 3–4 only where they require seed-derived instrument colors or
  retained `--chart-1` through `--chart-5` decorative slots. Components may continue consuming CSS
  variables, but the variables are compiler bindings rather than the authoring model. Unused chart
  slots are removed after consumer migration.
- It supersedes ADR 0002 Decisions 2, 3, 7, 11, and 13 for theme shape, seed derivation, chart slots,
  theme application, and registry shape.
- It supersedes ADR 0002 Decision 14 only for live draft distribution. Persisted settings may still
  use their domain's ordinary cross-window synchronization, but draft preview uses ordered ephemeral
  runtime messages rather than Store writes.
- ADR 0002 Decisions 1, 4–6, 8–10, and 12 remain: theme ID is the only color-theme identity axis;
  layout remains orthogonal; Appearance remains System or Fixed; `colorScheme` remains metadata;
  one dark first-paint placeholder remains sufficient; and System resolves to builtin Dark/Light.

The old ADR files remain unchanged as historical records.

## Decision

### 1. Versioned authoring themes

Persisted themes are versioned authoring documents. A V2 document stores only durable user intent:

```text
identity and metadata
core colors
purpose-specific palettes
sparse meaningful overrides
```

It does not store the complete resolved output. The directional shape is:

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
    // roleId: { kind: "color", value }
    // roleId: { kind: "reference", source }
  },
}
```

The schema module, not this illustrative snippet, owns final field names and validation.

Core colors and palette anchors are opaque. Effect opacity is a separate resolved value and is not
encoded into identity colors.

### 2. One authoritative Theme Role Registry

A single registry describes every intentional visible color role. A role may declare:

- a stable role ID and value kind;
- its family and user-facing description;
- a default source and pure derivation recipe;
- compatible reference targets;
- allowed Advanced override modes;
- CSS, Canvas, palette, asset, or native bindings.

The registry includes meaningful leaf roles so Advanced can expose “Waveform Centroid” or
“Loudness Short-term” without exposing CSS token names. It does not create entries for every
interpolation result, anti-aliased pixel, or arbitrary source-code expression.

Registry construction fails for duplicate IDs, missing dependencies, incompatible references,
unknown recipes, dependency cycles, or incomplete required bindings.

Editor layout remains curated. The registry provides metadata and validation, not an automatic UI
layout generator.

### 3. A pure Theme Compiler

One deterministic pure function resolves authoring intent:

```text
compileTheme(authoringTheme, roleRegistry) -> resolvedTheme
```

The compiler has no dependency on React, DOM, CSSOM, Canvas, Store, WebView, or Tauri. It:

1. normalizes and validates the V2 authoring document;
2. resolves compatible references;
3. applies default recipes in dependency order;
4. applies sparse overrides at registered leaf roles;
5. produces complete concrete colors, effect values, palettes, and consumer bindings;
6. rejects incomplete output instead of relying on renderer-local guesses.

Perceptual derivation uses OKLCH where practical. Compositing uses linear RGB where the result is a
final opaque color against a known surface. Recipe constants are code-owned and covered by golden
tests, not persisted into every theme.

### 4. Resolved Theme is the only runtime color contract

Everything after compilation consumes one complete immutable resolved theme. It includes:

- resolved role values;
- CSS-variable bindings for DOM and SVG;
- exact colors and palette inputs for Canvas;
- effect colors and opacities;
- `colorScheme` and any scheme-selected asset bindings;
- theme identity and content revision.

CSS variable names remain a compatibility/publication bridge for DOM, SVG, Tailwind, and shadcn
components. They are not persisted authoring keys.

Canvas consumers receive resolved colors and LUT inputs directly. They do not parse computed CSS to
discover theme data. Safety fallback colors may exist at the runtime boundary, but a complete
resolved theme never takes that path during normal operation.

Native consumers subscribe only to the resolved fields they need. A Primary Data edit therefore
does not reapply Glass or recreate tray assets.

### 5. A central Theme Runtime publishes revisions

Theme ID identifies a saved theme. Revision identifies resolved content and changes whenever an
active draft changes under the same ID.

The central runtime:

1. accepts a selected authoring theme or editor draft;
2. compiles it once;
3. publishes the resolved snapshot;
4. updates CSS bindings;
5. notifies Canvas and other consumers according to their selected role dependencies;
6. forwards ordered snapshots to other WebViews;
7. notifies native consumers only when their subscribed fields change.

Consumers compare relevant resolved inputs, not only theme ID. Palette lookup tables are rebuilt
only when the corresponding palette changes, and unrelated Canvas renderers do not redraw for a
Workspace-only edit.

### 6. Drafts are ephemeral and persistence is transactional

A new or edited custom theme is an in-memory draft. Preview publication is coalesced to at most once
per animation frame. No theme Store write occurs while editing, dragging, undoing, or redoing.

- Save validates, persists once, selects the saved custom theme, and publishes its resolved result.
- Cancel discards the draft and republishes the exact pre-editor resolved selection.
- Creating from System captures the currently resolved builtin as the draft base. Save switches to
  Fixed; Cancel restores System.

Undo groups a continuous picker gesture into one author action.

### 7. Cross-WebView preview uses ordered ephemeral snapshots

Dock and accessory WebViews must preview unsaved drafts without treating them as persisted settings.
The main Theme Runtime publishes an ephemeral resolved snapshot with a monotonically increasing
revision. Receivers ignore older revisions.

A ready handshake lets a newly opened or reloaded WebView request the latest complete snapshot; it
does not wait for the next edit. Saved theme selection continues through the normal persistence
domain, but live preview does not use storage as a message bus.

### 8. One migration boundary, no dual runtime

Raw persisted themes enter through one versioned boundary:

```text
raw -> version detection -> V1-to-V2 migration -> V2 normalization
```

All registry, editor, compiler, and runtime code consumes V2 only. Components never branch on theme
version.

Migration is deterministic and appearance-preserving:

- V1 Accent initializes both Interface Accent and Primary Data;
- V1 Accent Secondary initializes Secondary Data;
- V1 signal seeds initialize the Status Palette;
- V1 colormap initializes the Intensity Palette;
- the frozen V1 resolver captures the prior concrete output;
- differences from V2 automatic output are retained as sparse leaf overrides.

Migration does not guess whether a V1 concrete value was intended as automatic. A later explicit
“adopt automatic colors” action may remove migrated overrides, but automatic migration does not.

The V1 resolver, fixtures, and migration code remain isolated and may be deleted only when support
for all persisted V1 documents is deliberately retired.

### 9. Builtins use the same authoring and compilation path

Builtin Dark and Light are immutable V2 authoring themes. They compile through the same registry and
compiler as custom themes. Golden tests compare their resolved output with the approved current
appearance before migration ships.

First paint remains one generated dark placeholder. The generator consumes the builtin Dark
resolved CSS binding map rather than maintaining a separate hand-authored semantic palette.

### 10. Palette presets are immutable inputs, not live inheritance

Builtin palette presets live in a versioned registry by palette kind. Applying a preset copies a
full stop/anchor snapshot into the authoring theme and records optional provenance. Later changes to
the builtin preset do not silently recolor saved themes.

User-managed standalone preset libraries remain out of scope. Editing copied preset values changes
the palette state to Custom while retaining “based on” provenance where useful.

### 11. Structural validation is mandatory; aesthetic policing is not

Compilation and Save reject malformed colors, incomplete palettes, invalid stop order, missing or
incompatible references, cycles, and incomplete required output.

The first release does not reject, warn about, score, or repair low contrast or unconventional color
choices. There is no Theme Health subsystem or safe-color editor exception.

### 12. Old output paths are removed after migration

The implementation is a staged cutover, not permanent parallel systems. After all consumers use
Resolved Theme and the diagnostic-theme pass succeeds:

- remove V1 seed derivation from ordinary runtime;
- remove direct component theme lookup;
- remove Canvas computed-style color parsing;
- remove dead chart slots and unreferenced color tokens;
- replace hardcoded visible colors with registry bindings or an explicit fallback/asset allowlist;
- update `docs/architecture.md` and `docs/design-tokens.md` to describe only the delivered V2 path.

## Consequences

### Benefits

- Beginners can author a complete theme with a small set of understandable choices.
- Advanced users can override meaningful component roles without flattening the entire theme.
- User intent remains distinguishable from compiler output.
- DOM, SVG, Canvas, Dock, accessory windows, and native consumers receive one consistent result.
- Draft edits under a stable theme ID invalidate exactly the consumers whose values changed.
- Migration debt is isolated instead of becoming permanent conditionals throughout the app.
- New visible colors must enter through a reviewable registry contract.

### Costs

- The registry and compiler add an explicit dependency graph and validation layer.
- Existing Canvas consumers require migration away from computed CSS parsing.
- Appearance-preserving V1 migration may create many overrides for an old custom theme.
- Cross-WebView draft preview needs a small revisioned protocol and ready handshake.
- Builtin output requires golden maintenance when recipes intentionally change.

## Alternatives considered

### Keep V1 seeds and rename the editor labels

Rejected. Friendlier labels would not separate Interface Accent from Primary Data, make Canvas a
resolved consumer, support sparse leaf overrides, or fix overloaded semantic fields.

### Persist every resolved color

Rejected. A complete flat snapshot cannot distinguish author choice from compiler result, produces
no automatic improvement when recipes evolve, and makes Reset to Auto undefined.

### Store overrides relative to a builtin base

Rejected as the primary model. A builtin update could silently recolor saved themes. V2 stores
standalone Core and Palette intent; only internal role references are resolved dynamically within
the same theme.

### Let components derive their own variants

Rejected. Local derivation recreates inconsistent color math, hidden dependencies, Canvas cache
bugs, and incomplete Advanced control.

### Make CSS custom properties the authoring schema

Rejected. CSS names describe a publication mechanism, do not cover native or palette consumers
well, and expose implementation vocabulary to users.

### Write drafts to the theme Store for cross-window preview

Rejected. Cancel would require undoing external state, observers would see half-edited documents,
and high-frequency picker movement would become persistence traffic.

### Run V1 and V2 render paths indefinitely

Rejected. Dual runtime turns a bounded migration cost into permanent branching and doubles the
number of color contracts every component must support.
