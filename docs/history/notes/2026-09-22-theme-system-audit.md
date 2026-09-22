# Theme System Audit

Date: 2026-09-22  
Status: Completed audit snapshot; recommendations are not approved design decisions

## Purpose and boundary

This is an independent audit of the current Theme V2 implementation. It follows the mandatory
Theme audit identified by `2026-09-22-community-sharing-foundation-design.md` and is a gate before
the portable community Theme format is frozen.

The audit deliberately did not refactor code or tune colors. It reviewed the current abstractions,
renderer coverage, authoring UI, validation and migration boundaries, built-in Dark and Light
results, tests, documentation, and the requirements for repeatable visual verification.

This record separates observed facts from recommendations. A recommendation here is not an
approved architecture decision. Subsequent decisions need their own design record or ADR, and this
file remains frozen.

## Sources reviewed

The audit read the complete community-sharing foundation record and inspected, among other files:

- `src/theme/themeRoleRegistry.js`
- `src/theme/compileTheme.js`
- `src/theme/themeSchema.js`
- `src/theme/builtinThemesV2.js`
- `src/theme/palettePresets.js`
- `src/theme/themeRuntime.js`
- `src/theme/themeCanvasSelectors.js`
- `src/theme/migrations/` and the isolated V1 resolver
- `src/components/ThemeEditor.jsx`
- `src/components/theme-editor/`
- the Theme library, persistence ingress, first-paint generator, and resolved-theme hook
- CSS, SVG, Canvas, Dock, Spectrogram 2D/3D, Stereo Map, Waveform, Spectrum, Loudness, and
  Vectorscope consumers
- `docs/architecture.md` and `docs/design-tokens.md`
- Theme, editor, migration, renderer, token, and visual-contract tests

## Verification performed

The development-identity app was started and controlled through Agent Control. The audit captured
Dark and Light screenshots for empty and deterministic-data states, including the complete main
surface and representative panel targets. A generated 15-second stereo PCM fixture exercised
Level Meter, Loudness, Waveform frequency color, Spectrogram, Spectrum, Stereo Map, Stats, and
Vectorscope. The development instance was then restored to Follow System, Live source, an empty
File session library, and its original 60-second shared time axis before it was closed.

The following focused test run passed:

```text
31 test files passed
250 tests passed
```

It covered `src/theme`, Theme Editor, Theme hooks, the theme color contract, and Spectrogram Canvas
tests. Passing tests establish that the current implementation is internally consistent with its
encoded expectations; they do not establish visual correctness or portability.

Native Windows UI automation did not expose the PLVS window to the available computer-use surface,
so the Theme Editor could not be visually captured through that route. Its audit is based on source,
component tests, and the live Theme results rather than an editor screenshot.

## Current system map

```text
Legacy V1 document
    -> migrateV1Theme

Theme V2 authoring document
    - six Core Colors
    - Status, Intensity, Frequency, and Interface Palettes
    - sparse Advanced overrides
    -> tolerant persistence normalization
    -> strict ID-free authoring validation where requested

Theme Role Registry (82 roles)
    - Core: 6
    - Palette: 8
    - Interface: 19
    - Data: 10
    - Meter: 3
    - module roles: 36
    -> dependency graph + recipes + Advanced metadata + renderer bindings

compileTheme
    -> complete resolved role map
    -> 52 CSS binding entries
    -> 30 Canvas binding entries
    -> native output containing colorScheme only

themeRuntime
    -> revisioned, deeply frozen snapshot
    -> DOM CSS publication
    -> Canvas subscriptions through useResolvedTheme/selectors
    -> CSS publication to Dock accessory documents
    -> dark/light choice for macOS Glass material
```

The editor presents three pages:

1. Core: six authoring colors.
2. Palettes: Status, Intensity, Frequency, and Interface.
3. Advanced: 54 curated Interface and module leaf overrides.

## Designs worth retaining

The audit found a strong internal foundation. The following should be preserved unless later
evidence specifically disproves them:

- one compiler publishes CSS and Canvas results from the same authoring document;
- Interface Accent and Primary Data are independent;
- destructive interface red and metering critical red are independent;
- opaque Core Colors keep alpha at semantic leaf effects instead of contaminating primitives;
- Core, Palettes, and Advanced provide a useful progressive-authoring direction;
- palette values are stored as snapshots so an existing Theme does not inherit future preset edits;
- resolved runtime snapshots are revisioned, deeply frozen, and selectively subscribable;
- first-paint CSS is generated from the same V2 Dark source;
- V1 runtime code is isolated from production consumers and retained only for migration;
- the strict authoring validator can aggregate issues with JSON paths;
- Theme editing is a blocking editor, so scene operations cannot silently discard its live preview;
- revision-correlated Agent Control screenshots provide a sound base for a visual gallery.

## Findings ordered by severity and impact

### F1 — Portable semantics are not versioned independently of the application implementation

Severity: format blocker

A Theme V2 document declares only document version 2. Its visual output also depends on the current
application's role set, dependency graph, recipe functions and constants, compatible-reference
lists, and renderer bindings. Changing `SNAP`, `COMPANION`, surface mixing, or another recipe can
change an old document's appearance without changing or migrating that document.

This is acceptable for an internal persistence format under application control. It is not enough
for an immutable, hashable community artefact that should render predictably across compatible
PLVS versions.

The public design must either version the semantic/recipe model, materialize every portable
semantic value needed for reproduction, or declare and enforce an exact compatibility target with
versioned conversion. CSS variables, Canvas keys, and native bindings are runtime implementation
details and must not become portable authoring fields.

### F2 — Palette preset identity does not describe the palette value

Severity: format blocker and current editor defect

Both built-in themes label their palettes with `status-plvs`, `frequency-plvs`, and
`intensity-inferno`. The registered Status and Frequency presets contain the Dark values, while the
Light built-in uses different values under the same IDs. The built-in Inferno contains eleven
stops, while the registered preset with the same ID contains six.

Consequences:

- the same `presetId` does not identify one value;
- a Light-derived custom Theme can display “PLVS Default” although its value differs from that
  registered preset;
- selecting the displayed preset can change the palette while leaving its identity apparently
  unchanged;
- canonical equality and portable hashing cannot rely on `presetId`.

The two validation paths also disagree. Persistence normalization permits an unknown preset ID
because palette values are snapshots. Strict authoring validation rejects an unknown preset ID
because it is absent from the current application registry.

Preset provenance should either be omitted from the canonical portable document or be optional,
advisory metadata that never controls validity. If an ID remains meaningful in the editor, value
equality must be checked before that preset is shown as selected.

### F3 — Advanced exposes roles and bindings with no production renderer consumer

Severity: high

The registry intentionally keeps several future grid roles even though current documentation says
that Spectrum, Stereo Map, Waveform, and Loudness do not draw grids. Those roles still receive
Advanced editor metadata.

The static binding inventory found seven published binding entries with no production consumer.
The most important examples are the exposed grid roles and `waveform.selection`. A user can edit a
swatch, save successfully, and observe no corresponding visual change.

Future capability placeholders may exist in code, but they should not appear as authoring controls
or portable fields until they have a tested renderer consumer. Every Advanced control needs a
consumer contract proving which surface and state it changes.

### F4 — Not every visible production color is owned by Theme

Severity: high

Confirmed bypasses include:

- Recording Indicator using fixed Tailwind red;
- success, warning, and danger Badge variants using fixed Emerald, Amber, and Red;
- fixed `border-white/10` in controls, status pills, and hover tips;
- fixed white highlights and black shadows in shell surface styles;
- fixed meter fallback red, amber, and green in CSS.

Two hard-coded areas have a defensible exception:

- the crash boundary must render when the normal Theme path may have failed;
- the modal scrim is intentionally a fixed black directional dim rather than a semantic hue.

Those exceptions need an explicit audited allowlist. The current color-contract test protects a
few known patterns but does not prove the complete production-color ownership invariant.

### F5 — Registry role kind does not describe the resolved value kind

Severity: high architectural risk

The registry recognizes `color`, `palette`, and `effect`, but border, input border, and shadow are
declared as color roles while their recipes produce `{ color, opacity }` effect objects. Depending
on the selected override mode, one role can resolve to either a string or an effect object.

`KNOWN_RECIPES` is declared in the registry while the executable `RECIPES` map is separately
declared in the compiler. Registry validation proves that a recipe name is in one set, not that a
function with compatible input and output kinds exists in the compiler.

Resolved values should use explicit stable kinds such as solid color, color effect, and color
scale. Registry validation should prove recipe existence, dependency input kinds, output kind, and
renderer-binding compatibility.

### F6 — The default Themes contain measurable contrast failures

Severity: high visual/accessibility impact

WCAG contrast ratios calculated from the current compiled output include:

| Pair | Ratio | Finding |
| --- | ---: | --- |
| Dark content on Interface Accent | 2.02:1 | insufficient for normal text |
| Dark content on Critical | 3.20:1 | insufficient for normal text |
| Light content on Critical | 4.00:1 | below the normal-text target |
| Light Warning against panel | 1.49:1 | very weak |
| Light Primary Data against panel | 2.87:1 | below the 3:1 graphical guide |
| Light Safe against panel | 3.30:1 | just above the graphical guide |
| Light Secondary Data against panel | 4.77:1 | good |

The Dark surface ladder and general text hierarchy read well in the live capture. The Dark START
and REANALYZE treatments visibly use light text on orange; the design-token document still states a
dark foreground, so code and documentation disagree.

In the deterministic-data captures:

- Light Primary Data and yellow warning information approach the pale substrate too closely;
- Light Stereo Map fills are especially faint;
- one Inferno scale is used for both schemes, and low-intensity Spectrogram structure reads more
  weakly on Light than on Dark;
- Loudness Momentary and Short-term remain distinguishable, but much of the redundant distinction
  comes from stroke width rather than color distance.

These measurements are triage signals, not a request to enforce WCAG text ratios indiscriminately
on all dense data marks. Final thresholds must distinguish text, essential graphical objects,
decorative fills, and redundant encodings.

### F7 — Component color roles and visual-style tokens are not fully separated

Severity: medium

Stereo Map reads Spectrum's fill-opacity and stroke-width tokens. This cross-module borrowing is
not a color failure today, but it makes future authoring of effects or styles ambiguous. A public
Theme should not accidentally treat a Spectrum-named style as the Stereo Map contract.

### F8 — Native binding is a declared category without native color roles

Severity: medium

The registry permits native bindings, but no registered role supplies one. Resolved native output
contains only `colorScheme`. On macOS, that boolean chooses HudWindow or Sidebar vibrancy material.
The architecture document's claim of complete native roles is therefore stronger than the
implementation.

The eventual design must decide whether native is a real color-binding surface, a small appearance
capability outside Theme, or an intentionally scheme-only adapter. An empty public category should
not be preserved speculatively.

### F9 — V1 migration proves broad CSS compatibility, not complete visual compatibility

Severity: medium

Migration tests compare comparable CSS bindings, with reviewed exceptions, and check two
Spectrogram Canvas colors. They do not cover every Canvas role, the 3D floor and subdivisions,
Stereo Map, frequency-colored Waveform, native Glass, or screenshot equivalence.

The supported conclusion is that migration preserves broad CSS intent. It has not yet proved
complete visual intent across every renderer.

### F10 — Documentation and implementation have drifted

Severity: medium

Examples include:

- the design-token document says there are three purpose-specific Palettes; implementation has
  four;
- the document describes compiler output itself as immutable, while deep freezing occurs at
  runtime publication;
- the document says Waveform has no snapshot variant, while the registry, selector, and painter
  contain one;
- the document acknowledges non-rendered grid roles without explaining that they remain editable;
- the architecture says native roles are complete, but there are no native role bindings.

## Assessment of the current classifications

### Core Colors

The six inputs are a reasonable compact starting point, particularly the split between interface
accent and two data colors. `surface` currently carries too broad a user description—panels,
popovers, and controls are not the same resolved role—but the compiler does derive separate
semantic surfaces from it.

The main unresolved question is whether `text` and one `surface` pole provide enough control for
both high-quality Dark and Light themes without forcing many Advanced overrides.

### Palettes

Status, Intensity, and Frequency are coherent purpose palettes. Interface currently contains only
Critical; treating a one-color group as a palette is structurally awkward. It may be better as an
interface semantic authoring input unless more interface safety colors are expected.

Intensity is correctly modeled as an ordered scale rather than one color. Dark and Light should
not be assumed to share the same scale or compositing behavior without gallery evidence.

### Interface, Data, Meter, and module roles

The semantic layering is useful, but the current registry mixes:

- reusable semantic roles;
- renderer publication bindings;
- editor presentation metadata;
- future unused roles;
- component-specific leaves.

`data.*` provides valuable shared semantics, while many module roles are identity pass-throughs
whose main purpose is Advanced override and binding. That can be appropriate, but only for roles
with a real consumer and a stable public meaning.

### Effect

Effect is currently an override shape rather than a consistently typed role family. Border and
shadow demonstrate the need for color-plus-opacity, but the model should make that a resolved value
kind rather than an exceptional editor mode on a nominal color role.

## Recommended conceptual boundaries

Use these meanings consistently:

- **Authoring input**: a user-facing Core, Palette, or explicitly public leaf override.
- **Role**: a stable semantic visual slot with a declared resolved value kind.
- **Recipe**: a versioned compiler implementation that derives a role; it is not serialized.
- **Dependency**: an internal recipe graph edge; it is not serialized.
- **Reference**: an authored “follow this stable public role” decision; it is serialized only when
  both source and target belong to the public semantic contract.
- **Binding**: a version-specific CSS, SVG, Canvas, or native adapter; it is never serialized in a
  portable Theme.

The registry may continue to be the internal source of truth, but authoring metadata, recipe
typing, and renderer adapters should be separable and independently testable.

## Theme Editor assessment

The Core / Palettes / Advanced progression matches a useful user mental model and should remain.
The current Advanced page is too close to the complete internal leaf registry:

- it contains 54 controls;
- section grouping is module-oriented but does not explain state or visible target;
- it exposes unused roles;
- it does not show the Theme's Light/Dark scheme even though scheme changes recipes and native
  Glass behavior;
- it offers no contrast warning or affected-surface preview;
- reference choices are curated correctly, but their “follow” semantics and portability contract
  are not explicit;
- misleading preset identity can make a palette appear selected when its value differs.

Advanced should contain only consumed, stable semantics. Scheme should be visible and explained.
The editor should eventually show affected surfaces, provide section reset, and report warnings
without preventing intentionally unconventional Themes.

## Visual verification method

Do not approve default colors by reviewing hex values alone. Use four layers:

1. **Numeric checks**
   - text and essential graphical contrast by role and substrate;
   - pairwise perceptual distance for simultaneous traces and statuses;
   - monotonic or deliberately structured luminance for intensity scales;
   - gamut and canonical-color checks.
2. **Perceptual checks**
   - protanopia, deuteranopia, tritanopia, and grayscale simulations;
   - 100%, 125%, and 200% display scaling;
   - minimum panel dimensions and all supported Interface Sizes;
   - ordinary and low-luminance displays.
3. **Semantic checks**
   - Primary, Secondary, Snapshot, Selection, Warning, and Critical do not exchange meaning;
   - frequency hue is not reused for unrelated state;
   - important states retain non-color redundant encoding.
4. **Real renderer checks**
   - DOM/CSS, SVG, Canvas 2D, Canvas 3D, Dock accessory documents, and macOS Glass;
   - stable data fixtures and stable paint settlement;
   - screenshots tagged with Theme, state, dimensions, DPI, platform, revision, and fixture hash.

## Proposed Theme gallery matrix

At minimum, cross these dimensions:

- Theme: built-in Dark, built-in Light, low-contrast stress Theme, unusual-accent Theme, and a
  monochrome/color-vision test Theme;
- surface: the eight Workspace modules, every Dock module, Dock Header, Dock Editor, Settings,
  Theme Editor, menus, popovers, confirmation dialogs, and crash fallback;
- state: empty, Live, File, snapshot/selection, max hold, warning, critical, disabled, hover,
  keyboard traversal, and destructive confirmation;
- Spectrogram: Heatmap, 3D Lines, 3D Surface, colorized, and monochrome;
- size: narrow, representative, and wide panels; four Interface Sizes; Dock at 56, 82, and 160px;
- topology: mono, stereo, and high channel count where applicable;
- platform: Windows and macOS, with Glass on and off where supported.

A manifest should drive deterministic application state and Agent Control screenshots. Outputs
should include per-surface images, a contact sheet, and machine-readable contrast/perceptual
metrics. Pixel differences are regression signals, not automatic proof of visual correctness.

## Recommended phased work

### Phase 0 — Agree on the model before changing colors

- inventory every role, consumer, renderer, and visible state;
- approve the hard-coded exception policy;
- decide public versus internal role identity;
- decide semantic-model versioning and preset provenance;
- classify dead, duplicate, overly broad, and overly narrow roles.

### Phase 1 — Tighten the internal type and validation model

- introduce explicit resolved value kinds;
- make recipe existence and input/output compatibility mechanically validated;
- separate persistence normalization, legacy migration, strict authoring validation, and
  publication validation;
- return precise role/document paths for compiler incompatibility;
- repair preset identity semantics.

### Phase 2 — Complete renderer ownership

- remove or theme every unapproved hard-coded production color;
- remove or hide unconsumed roles and bindings;
- add consumer-contract tests for CSS/SVG, Canvas, and native adapters;
- remove cross-module style-token borrowing.

### Phase 3 — Reshape Theme Editor

- retain Core / Palettes / Advanced;
- make scheme visible;
- show only stable consumed Advanced roles;
- add affected-surface information, warnings, and section reset;
- ensure preset selection reflects value equality.

### Phase 4 — Build the gallery, then tune Dark and Light

- establish deterministic fixtures and screenshot production;
- approve contrast and perceptual thresholds by semantic category;
- tune Accent foreground, Light warning and Primary Data, Light Spectrogram, trace families, and
  status/frequency separation;
- approve both platforms and relevant native effects.

### Phase 5 — Specify the portable Theme document

- define the canonical ID-free authoring document;
- version document shape separately from semantic compilation compatibility;
- define unknown-role/reference and newer-version outcomes;
- define limits for size, stop count, override count, and reference depth;
- require canonical round trips and stable hashes;
- use the same pure validator and converter in desktop, CLI, community intake, and CI.

## Acceptance conditions before freezing public Theme sharing

All of the following must be true:

- every production-visible color has a Theme owner or an approved, documented exception;
- every public or editable role has a real renderer consumer and representative state coverage;
- Theme Editor contains no no-op control;
- resolved value and recipe types are mechanically valid;
- a canonical document has reproducible results throughout its declared compatibility range;
- preset provenance is unambiguous or absent from canonical content;
- strict validation returns structured errors and warnings with accurate paths;
- desktop, CLI, community validation, and repository CI share validators and converters;
- unknown required roles or references cannot disappear silently;
- V1 migration is verified across CSS/SVG, Canvas, native behavior, and representative screenshots;
- built-in Dark and Light pass the approved contrast, color-vision, and gallery review;
- every module and important UI state appears in the repeatable gallery;
- export, validate, import, and re-export produce stable canonical content and hashes;
- architecture, design-token, user, schema, registry, compiler, and editor vocabulary agree.

## Questions to resolve next

The audit recommends resolving these in order because later answers depend on earlier ones:

1. What exactly is the portable authoring contract, and how is its compilation semantics versioned?
2. Which current roles are stable public semantics, internal derivations, renderer bindings, or dead
   placeholders?
3. Are presets canonical content, advisory provenance, or editor-only affordances?
4. What are the exact typed value kinds and recipe constraints?
5. Which hard-coded colors are defects, and which are approved exceptions?
6. What should the Core and Palette user model expose, including Light/Dark scheme?
7. What belongs in Advanced, and what preview/warning support does it need?
8. What quantitative and human-review gates approve the built-in Dark and Light Themes?
9. What deterministic gallery matrix is required in CI and release review?
10. Only after the above: what is the final portable Theme schema and compatibility policy?
