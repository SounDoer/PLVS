# Theme System Model Design

Date: 2026-09-23  
Status: Active design discussion

## Purpose

This record captures decisions made while reviewing the Theme System Audit. It is intentionally
incremental: unresolved areas remain open until they have been discussed, and implementation does
not begin merely because a decision is recorded here.

## Confirmed decisions

### Portable Theme contract

- A portable Theme preserves stable authoring semantics, not cross-platform pixel identity.
- Portable content contains authoring intent: color scheme, Core Colors, Palette values, and
  explicit public Advanced overrides.
- Recipe implementations, dependency graph edges, CSS variables, Canvas selector keys, and native
  bindings are application internals and are not serialized as authoring content.
- Document-shape versioning and semantic-compilation versioning are separate concerns.
- An application must not silently reinterpret a Theme within its declared semantic compatibility
  range. Moving to a new semantic model requires explicit conversion or an incompatibility result.
- Palette preset provenance is advisory metadata, not canonical content, validity, or identity.
- Gallery evidence records its exact application version, platform, dimensions, and data fixture
  separately from the Theme document.

### Public role boundary

- Advanced overrides may be portable, but only for an explicit allowlist of stable semantic roles.
- A public override role must be understandable without renderer knowledge, have a real visible
  production consumer, retain meaning across renderer implementations, identify its affected
  surface in the editor, and have representative gallery coverage.
- Authoring inputs, public semantic roles, internal derived roles, and renderer bindings are
  distinct layers.
- Internal derived roles such as shared data recipes are not serialized merely because they exist
  in the registry.
- CSS variables, Canvas selector keys, and native adapters are bindings and are never public Theme
  fields.
- Future placeholders and roles without consumers are not exposed in Advanced or the portable
  contract.

### Core authoring model

- Retain the six existing Core Color concepts; do not add Border, Grid, Snapshot, or other derived
  colors to Core.
- Expose the Theme's Dark or Light appearance explicitly alongside the Core Colors. Appearance is
  a compilation and native-surface choice, not a color inferred from the six values.
- The editor labels are `Workspace`, `Surface`, `Text`, `Accent`, `Primary Data`, and
  `Secondary Data`.
- The persisted field remains `core.interfaceAccent`; simplifying its editor label does not rename
  the schema field.
- `Surface` is the authoring seed for panels, popovers, neutral controls, and muted regions. Its
  label remains concise; its description explains that derived surfaces need not use the exact
  input value.
- `Text` means the primary foreground for text and icons. Secondary and annotation foregrounds are
  derived. Its public meaning does not include every internal use of the value as a calculation
  pole.
- `Accent` covers primary actions, selected controls, and focus indicators, and does not affect
  measurement data.
- Accent and Primary Data remain independent even when a built-in Theme assigns them the same
  color.
- Primary Data is the main measurement emphasis. Secondary Data is an independent comparison,
  channel, or side color; it is distinct from a companion color derived from Primary Data.
- The exact surface-ladder recipe and contrast-content recipes for colored backgrounds remain open
  for the later Interface and recipe review.

### Status Palette

- Retain Status as one three-color authoring Palette.
- The editor labels are `Safe`, `Warning`, and `Critical`; the former `Good` label is replaced by
  `Safe` because this Palette expresses an acceptable measurement or rule range, not a subjective
  quality judgment.
- The future public semantic key is `safe`. Existing internal and persisted `good` keys require an
  explicit compatibility migration rather than silent reinterpretation.
- Status is restricted to measurement semantics: meter regions, limits, correlation safety,
  measurement-rule outcomes, and related Canvas marks. It does not color ordinary application
  feedback, validation, badges, destructive actions, or activity modes.
- The three authored colors are semantic seeds. Measurement roles are derived for their substrate
  and mark type; one authored color is not necessarily published unchanged to every meter or Canvas
  surface.
- The editor describes the group as safe, warning, and critical states for meters, limits, and
  measurement results.

### Intensity color scale

- Retain the concise editor label `Intensity` rather than binding the authoring concept to the
  Spectrogram module name.
- Intensity is an ordered color scale, not a discrete named-color Palette: stops have positions,
  order is significant, and colors between stops are interpolated.
- The current production consumer is Spectrogram. A future view may reuse Intensity only when it
  represents the same low-to-high measurement-intensity meaning, not merely because it needs a
  gradient.
- The editor should explain the current Spectrogram use without making Spectrogram part of the
  semantic name.
- Stop positions should be presented to audio users as their mapped dB values. The portable value
  may remain normalized from 0 to 1 when its semantic-model version defines the stable mapping.
- Inferno has one canonical stop list. A built-in Theme and a preset must not use the same preset ID
  for different values; the complete current 11-stop definition is the preferred canonical source.
- Preset selection is determined by equality with the current Palette value. Editing any stop makes
  the value Custom. Preset provenance remains optional, advisory metadata.
- Dark and Light Intensity scales are independently validated and may use different authored values.

### Frequency color scale

- Retain the concise editor label `Frequency` and the three `Low`, `Mid`, and `High` authoring
  anchors.
- Frequency is an ordered color scale whose anchors are interpolated for a measured frequency. Its
  semantic dimension is low-to-high frequency, distinct from Intensity's weak-to-strong dimension.
- The current production consumer is Waveform Frequency Color. A future frequency visualization
  may reuse the scale only when it carries the same low-to-high frequency meaning.
- Frequency split points remain view or panel settings. A Theme determines the colors of frequency
  regions, not the Hz boundaries used by an analysis view.
- Frequency Neutral remains an internal derived role. It does not become a fourth authored anchor
  because it must intentionally carry no frequency meaning.
- The interpolation color space is not part of authoring. sRGB and perceptual interpolation must be
  compared in the visual gallery, including pairwise distinction, color-vision simulations,
  Dark/Light substrates, and possible confusion with Status colors.
- Dark and Light PLVS preset values have distinct internal identities even when both are displayed
  as `PLVS Default`. Preset selection is established by value equality, not by a shared ID.

### Interface Palette and activity roles

- Retain Interface as a discrete three-color authoring Palette with `Success`, `Warning`, and
  `Danger` inputs.
- Interface colors are independent from Status colors. A meter may need a light, vivid mark while
  interface text, tinted feedback, or a solid button needs a darker or otherwise different color.
- Interface Success covers successful application feedback. Interface Warning covers application
  cautions and recoverable problems. Interface Danger covers errors, invalid states, and
  destructive actions.
- Each authored Interface color is a seed for usage-specific foreground, tint surface, solid
  surface, border or ring, and content-on-color roles. The same value is not published unchanged to
  every usage.
- Status remains measurement-only; Badge variants, validation, application messages, and dangerous
  controls use Interface roles instead of borrowing meter colors.
- No Interface Info input is added without an independent production meaning. Neutral information
  continues to use normal Text or Accent-derived roles.
- `LIVE`, `SNAP`, and recording are activity modes rather than measurement status or feedback
  severity. They receive dedicated internal roles such as `activity.live`, `activity.snapshot`, and
  `activity.recording`; those roles may have defaults that reference Interface colors but do not add
  Core or Palette inputs.
- The ambiguous `--ui-signal-*` binding family must be split by consumer into measurement,
  Interface feedback, and activity bindings. Binding names remain internal implementation details.
- A compatibility migration maps old Status Good to Status Safe, retains old Status Warning and
  Critical, seeds Interface Success and Warning from the corresponding old Status values, and maps
  old Interface Critical to Interface Danger. Roles whose old appearance came from shared signal
  bindings require explicit compatibility overrides or reviewed visual changes.

## Open areas

The next area is the Interface surface ladder: Panel, Raised, Control, Muted, and Interactive.
