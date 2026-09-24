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
- Primary Data and Secondary Data are independent first and second data-series colors. They can
  distinguish concurrent measurements, comparisons, channels, or sides; `Secondary` does not mean
  lower importance or reduced visual emphasis. A companion color derived from Primary Data remains
  an internal option for genuinely related variants, not the default substitute for a second
  meaningful series.
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

### Interface surface roles

- Retain five surface semantics, organized conceptually as structural `Panel` and `Raised` surfaces
  plus control-state `Control`, `Muted`, and `Selected` surfaces.
- Rename the current `Interactive Surface` semantic to `Selected Surface`. Its real consumers are
  selected, open, enabled, or active controls rather than every interactive or hoverable element.
- Panel defaults directly from the Core Surface authoring seed.
- Raised is separated from Panel by an intentional combination of surface color, border, and shadow;
  elevation is not defined as always lighter or always darker.
- Control communicates neutral affordance. Muted communicates reduced emphasis. They remain
  distinct roles and must not continue to share an identical default recipe.
- Selected carries a visible Accent relationship without becoming the solid Accent used for primary
  actions.
- Raised, Control, and Muted are not one monotonic lightness ladder because they express different
  semantic dimensions.
- Hover remains an internal state derived from the relevant surface role; it does not add a Core
  Color or public authoring input.
- Gallery validation checks Workspace/Panel separation, Raised layering, Control affordance, Muted
  de-emphasis, and Selected recognition independently for Dark and Light Themes before recipe
  constants are approved.

### Interface text and content roles

- Retain `Primary`, `Secondary`, and `Annotation` as the three text semantics derived from Core
  Text.
- Primary covers ordinary text, headings, important values, and normal icons. Secondary covers
  supporting labels, descriptions, and metadata. Annotation covers compact technical labels,
  units, axes, and ticks.
- Annotation is not a third, faintest hierarchy level. Its typically smaller size may require more
  contrast than Secondary.
- Neutral surfaces do not receive separate content-on roles. Workspace, Panel, Raised, Control,
  and Selected use Primary or Secondary Text as appropriate; Muted normally uses Secondary Text.
  Their surface recipes and validation must keep those shared text roles readable.
- Renderer variables such as card, popover, control, selected, and muted foregrounds are bindings
  to the smaller semantic text set, not evidence that each requires a public Theme role.
- Retain four symmetric solid-surface content roles: `Content on Accent`, `Content on Success`,
  `Content on Warning`, and `Content on Danger`.
- Each content-on role is contrast-derived for its actual solid substrate and may be overridden in
  Advanced. A tint foreground and content on a solid semantic surface remain different roles.
- `Content on Accent` is consumed by primary actions and `Content on Danger` by destructive actions.
- Existing copy-success states in `CopyableTextBlock` and the file-report Export trigger become
  short-lived solid Success controls that consume `Content on Success`.
- The unknown-loudness-layout marker and Audio Dropped indicator become compact solid Warning
  treatments that consume `Content on Warning`.
- Completed file-history rows remain neutral, History Truncated remains a Warning foreground/tint,
  and activity and measurement states are not recolored merely to create semantic consumers.
- Interface Success, Warning, and Danger also derive usage-specific foreground, tint, border, and
  solid-surface roles. Existing hard-coded Badge variants migrate to those Interface roles.
- Built-in Themes must meet the approved text-contrast gate. Custom Themes receive explicit
  warnings for unsafe combinations while retaining intentional override freedom.
- In Advanced, these semantics appear under one `Text & Icons` section with three subgroups:
  `General` contains Primary, Secondary, and Annotation; `Feedback` contains Success, Warning, and
  Danger text-and-icon colors used on ordinary or tinted feedback; `Contrast` contains Accent,
  Success, Warning, and Danger text-and-icon colors used on the corresponding solid backgrounds.
- The editor does not expose `Foreground`, `Content on`, or `Solid Surface Content` as user-facing
  group names. A Contrast description explains that the Palette or Core input controls the solid
  background while the Advanced value controls the text and icons placed on it.

### Interface effect roles

- Advanced exposes only three effect choices: `Border Color`, `Focus Color`, and `Shadow Color`.
- Theme authors choose opaque colors for these roles. The editor does not expose opacity or alpha
  controls; effect opacity remains a compiler-owned part of the resolved recipe.
- Input Border is not a separate authoring choice. It derives from Border Color with a stronger
  system-managed treatment so controls remain legible without adding a nearly duplicate option.
- Surface highlights remain internal derivations rather than public Theme roles.
- Focus means keyboard and accessibility focus indication. Selected, active, and drag states must
  bind to their own semantics instead of reusing Focus merely because the current rendering looks
  similar.
- Shadow geometry, blur, spread, and elevation remain design-system tokens outside Theme
  authoring. Theme controls only the shadow color; its effective strength is resolved internally.
- Resolved implementation types still distinguish a solid `Color`, an `Effect` containing color
  and compiler-owned opacity, and an ordered `Color Scale`. The current registry declarations that
  label border and shadow outputs as plain colors must be corrected when implementation begins.
- Authored surface colors remain opaque. Components may still composite surfaces with opacity and
  backdrop blur, but those compositor treatments are not Theme values and must not silently change
  the authored color's meaning.
- The gallery compares fully opaque surfaces, the current translucent treatments, and translucency
  limited to floating layers before the product chooses a compositor policy. This audit does not
  pre-emptively require every rendered panel to become opaque.

## Open areas

### Data, Meter, and module override boundary

- Core Primary Data and Secondary Data are global authoring seeds. Generic data roles such as
  companion, snapshot, selection, grid, and annotation form an internal derivation layer rather
  than a separate Advanced editor section.
- Meter Safe, Warning, and Critical consume the measurement Status Palette. Meter is a consumer,
  not a second authored Palette, and does not duplicate those three global choices by default.
- Module-specific Advanced roles remain valid even when their Auto recipe follows a global Core or
  Palette input. They allow one visualisation to depart from the global rule without changing
  other current or future consumers.
- Retain the existing `Auto`, explicit `Follow …`, and `Custom` model. Auto means use the module
  role's default recipe; Follow stores an intentional reference to a compatible source; Custom
  stores a local authored color. An explicit Follow can therefore remain meaningful even when its
  current output happens to equal Auto.
- Waveform Low, Mid, and High Frequency remain available as local Advanced roles. Auto follows the
  matching Frequency Palette anchor, while Custom can compensate for Waveform-specific rendering
  or background conditions without redefining the global frequency semantics.
- Editing a global source updates Auto and explicit Follow consumers but does not erase Custom
  overrides. Returning a role to Auto removes its stored override from the shared Theme document.
- A module option is not rejected merely because a global default exists. Each option is retained
  only when a module-local difference is plausible, its semantic meaning is stable, its source is
  clear in the editor, and the result can be covered by the gallery.
- Standardise the user-facing structural role label as `Grid` across Loudness, Spectrum,
  Spectrogram, Vectorscope, Stereo Map, and Waveform. Grid includes plot grid lines, structural axis
  lines, and reference rules, but never text. Ordinary axis and tick text follows Annotation or
  Secondary Text; a module exposes `Axis Labels` only when it has a real independently themed text
  consumer, as the 3D Spectrogram Canvas does.
- Retain `Grid Subdivisions` only where a real secondary grid layer exists. Additional modules may
  add the same role during the imminent grid design rather than encoding major and minor lines into
  an ambiguous `Grid and Axes` label.

### Loudness module roles

- Momentary and Short-term remain separate Advanced roles because both are important concurrent
  series and need reliable visual distinction.
- Momentary Auto follows Primary Data. Short-term Auto follows Secondary Data instead of deriving a
  companion color from Primary Data.
- Primary and Secondary describe the first and second concurrent data series here, not an
  importance hierarchy. Short-term must not be rendered with reduced emphasis merely because it
  uses Secondary Data.
- Momentary Snapshot and Short-term Snapshot remain module roles and derive from the corresponding
  live series by default. A Custom override may change either snapshot locally.
- Reference Guide remains a Loudness role because the current chart consumes it and its meaning is
  specific to that visualisation.
- Loudness Selection remains as a local override whose Auto source is the shared data-selection
  semantic. Spectrogram, Waveform, and timeline selection affordances must stop consuming the
  Loudness-named CSS binding and use their own resolved role or a correctly named shared binding.
- Retain Loudness Grid in Advanced because module-grid design is the next committed design area,
  rather than an unspecified future placeholder. It must gain a real consumer, gallery case, and
  visual contract before the public Theme format is frozen.

The next area is applying the same retention test to Spectrum.

### Spectrum module roles

- Retain Primary Trace and Secondary Trace. Their Auto recipes follow Primary Data and Secondary
  Data respectively, while explicit Follow and Custom remain available.
- Retain Primary Snapshot and Secondary Snapshot. Each derives from its corresponding live trace by
  default and may be overridden locally.
- Retain Spectrum Grid in Advanced because module-grid design is the next committed design area.
  It must gain a real consumer, gallery case, and visual contract before the public Theme format is
  frozen.
- Spectrum does not currently need a Selection color. Selecting a historical time replaces the
  displayed frequency curves with their Primary Snapshot and Secondary Snapshot colors; Spectrum's
  horizontal axis is frequency, so it does not draw the time-position marker used by timeline
  modules. A Spectrum Selection role should be added only if a distinct selected mark or region is
  designed, not merely for symmetry with other modules.

The next area is applying the same retention test to Spectrogram.

### Spectrogram module roles

- Retain all six currently consumed Spectrogram Advanced roles: the two monochrome data inks,
  Grid, Grid Subdivisions, Axis Labels, and Selection.
- Rename the user-facing `Monochrome Ink` label to `Monochrome Lines`. It controls 3D Lines mode
  when Colorize is disabled and follows Secondary Text by default.
- Rename the user-facing `Surface Ink` label to `Monochrome Surface`. It controls 3D Surface mode
  when Colorize is disabled and follows Primary Text by default.
- When Colorize is enabled, the data body follows the global Intensity scale. The module's Grid,
  Grid Subdivisions, Axis Labels, and Selection remain independent local roles.
- Grid and Grid Subdivisions remain separately overrideable because they are real major and minor
  floor-rule consumers in the 3D renderer. Axis Labels and Selection likewise remain because the
  Canvas renderer consumes them directly.

The next area is applying the same retention test to Vectorscope.

### Vectorscope module roles

- Retain Trace, Snapshot, and Grid. Trace follows Primary Data by default, Snapshot derives
  from Trace, and the grid is a real consumer in the Lissajous and Polar renderers.
- Do not add a Vectorscope Selection role. Selecting a historical time replaces the complete plot
  with its Snapshot appearance; the module has no time axis or distinct selected-position mark.
- The correlation marker continues to express measurement Safe, Warning, and Critical semantics.
  Add module-local `Correlation Safe`, `Correlation Warning`, and `Correlation Critical` Advanced
  roles. Auto follows the corresponding global Status color, while Custom affects only the
  Vectorscope correlation marker and does not recolor the main trace.
- The size of a rendered mark is not a stable reason to deny a module override. Palette consumers
  are reviewed consistently for local overrides whether they render a small marker or a large data
  field; specific labels state the affected object so the scope remains clear.

The next area is applying the same retention test to Stereo Map.

### Stereo Map module roles

- Retain Primary Side, Secondary Side, Primary Snapshot, Secondary Snapshot, and Grid.
  The live sides follow Primary and Secondary Data by default, and each snapshot derives from its
  corresponding live series.
- Retain Grid and Axes for the imminent module-grid design. It must become a real rendered consumer
  and gallery case before the public Theme format is frozen.
- Position and M/S Ratio modes encode their data with Primary and Secondary colors. Correlation and
  Mono Loss modes instead encode their data with a continuous Critical-to-Warning-to-Safe scale.
- Add local `Safe Range`, `Warning Range`, and `Critical Range` Advanced roles. Auto follows the
  corresponding global Status color, while Custom changes only Stereo Map's Status-based modes.
- Do not add a Stereo Map Selection role. Selecting a historical time switches the complete plot
  to its Primary and Secondary Snapshot appearance rather than drawing a selected time-position
  mark.

The next area is applying the same retention test to Waveform.

### Waveform module roles

- Retain all nine Waveform Advanced roles in the same flat module list used by other sections. Do
  not introduce Waveform-only subgroup UI; conceptual categories may be used in documentation and
  gallery coverage without changing the editor hierarchy.
- Trace follows Primary Data and Snapshot derives from Trace by default.
- Low, Mid, and High Frequency follow the corresponding global Frequency anchors by default and
  retain module-local Custom overrides.
- Rename the user-facing `Frequency Neutral` label to `No Dominant Frequency`. It is the neutral
  fallback for silence, noise, broadband material, or unavailable spectral classification; it is
  not another frequency band. Auto continues to derive it from Surface and the three Frequency
  anchors.
- Rename the user-facing `Centroid` label to `Spectral Centroid`. Auto follows Text and Custom may
  tune the overlay specifically for Waveform.
- Retain Grid for the imminent module-grid design and retain Selection as the local selected-time
  marker color.
- Add local `Warning Range` and `Critical Range` Advanced roles for Loudness Profile coloring. Auto
  follows global Status Warning and Critical; Custom affects only the breached portions of
  Loudness traces.
- Do not add a Loudness Safe Range role. In-range portions retain their Momentary or Short-term
  series color so the two measurements remain identifiable; recoloring both with Status Safe would
  erase that distinction without representing an existing visual role.
- Repair the current binding boundary during implementation: `waveform.selection` exists in the
  registry but is absent from `selectWaveformCanvasColors`, while the rendered selection line and
  shared edge hint consume `--ui-loudness-selection`. Each module must consume its own resolved
  Selection role or a correctly named shared selection binding.

The next area is deciding which Meter and measurement modules receive local overrides for the
global Status Palette.

### Level Meter module roles

- Add local `Safe`, `Warning`, and `Critical` Advanced roles for Level Meter. Auto follows the
  corresponding global Status color; Custom changes only the Level Meter gradient.
- The normal panel and Dock rendering of Level Meter share the same module roles. Dock is another
  surface for the same instrument, not a separate authored color system.
- Replace the current shared `--ui-signal-*` dependency with resolved module bindings so a Level
  Meter override cannot recolor Vectorscope, Stereo Map, Stats, or application feedback.

### Stats module roles

- Add local `Warning Value` and `Critical Value` Advanced roles for Stats. Auto follows global
  Status Warning and Critical; Custom affects only Stats readouts.
- Pending measurements continue to use Warning Value because the result is not yet valid and needs
  attention without representing a failure. Normal, unwatched, and in-range values retain Primary
  Text rather than Status Safe, avoiding an all-green measurement table.
- Normal Stats and Dock Stats share these module roles. Do not add a Safe Value role without a
  distinct safe-colored consumer.

### Module roles across normal and Dock surfaces

- A normal panel and its Dock representation share the same semantic module roles by default.
  Dock may resolve substrate-specific contrast internally, but it does not create a parallel public
  color system merely because its geometry and density differ.
- Module-local Status overrides therefore apply to the matching Dock module where it presents the
  same measurement meaning. Application activity and feedback that currently borrow
  `--ui-signal-*` migrate to Activity or Interface roles instead.

The next area is the boundary between roles, recipes, dependencies, references, and bindings.
