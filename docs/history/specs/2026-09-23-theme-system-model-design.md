# Theme System Model Design

Date: 2026-09-23  
Status: Approved design direction; implementation and gallery validation pending

## Purpose

This record captures decisions made while reviewing the Theme System Audit. It was developed
incrementally and now records the approved direction; exact built-in values remain subject to the
agreed deterministic gallery. Implementation does not begin merely because a decision is recorded
here.

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
- Future community sharing should support direct website `Copy` and PLVS `Paste/Import` so users do
  not have to download and locate a `.plvstheme` file. Clipboard sharing is a transport for the same
  canonical portable Theme document, with the same validation, compatibility checks, limits, and
  artifact identity; it must not create a second content format.
- The exact clipboard representation, browser permission and fallback behavior, paste entry point,
  and human-readable versus compact encoding are deferred to a focused sharing-UX discussion.

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
- Appearance is not a standalone tab. A compact Dark/Light segmented control sits with the Theme
  identity at the top of the editor, or at the top of Basic on constrained layouts, so the scheme
  remains visible without creating a one-control destination.
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
- Exact surface-recipe deltas and built-in color values remain gallery decisions rather than
  additional authoring concepts.

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
- Each authored Interface color is the corresponding solid substrate and the seed for
  usage-specific foreground, tint, border, and ring derivations. Content-on-color is a separate
  paired role; no second authored or automatically darkened solid color is introduced.
- Status remains measurement-only; Badge variants, validation, application messages, and dangerous
  controls use Interface roles instead of borrowing meter colors.
- No Interface Info input is added without an independent production meaning. Neutral information
  continues to use normal Text or Accent-derived roles.
- `LIVE`, `SNAP`, and recording are activity modes rather than measurement status or feedback
  severity. The public Advanced roles are `activity.live` and `activity.snapshot`; they do not add
  Core or Palette inputs.
- Advanced exposes a compact `Activity` section with only `Live` and `Snapshot`. Each resolved
  color drives its label or dot, border, tint, and glow through internal composition rules; neither
  requires a content-on role.
- Activity Auto deliberately reuses Interface Palette sources rather than adding another authored
  color set: Live follows Interface Danger (the renamed old Interface Critical), and Snapshot
  follows Interface Warning. These dependencies never point to measurement Status or Data Snapshot
  roles. Follow and Custom use the normal Advanced override model and detach the individual
  Activity role from its Auto source.
- Screen Recording means Agent Control visual capture of a PLVS surface. It is a small internal
  consumer that follows the resolved Live color and is not independently exposed or serialized as
  a public override. Ready remains neutral and does not gain an Activity color.
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
- In the opaque baseline, Surface roles are not a single five-step lightness ladder. Panel is the
  ordinary substrate; Raised separates through surface difference together with Border and Shadow;
  Control makes operable regions discoverable; Muted is quieter and must not resemble an operable
  Control; Selected carries the Accent relationship.
- The current compiler gives Control and Muted the same `Surface -> Text` 7% recipe. Their default
  results must become visibly distinct without adding another public Surface role. Exact values and
  recipe deltas remain gallery decisions rather than being approved from percentages alone.
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
- Current built-in opaque Panel measurements are approximately 16.31:1 / 6.10:1 / 8.42:1 for
  Dark Primary / Secondary / Annotation and 17.05:1 / 4.53:1 / 6.84:1 for Light. Light Secondary
  sits too close to the 4.5:1 threshold and should gain modest headroom in the default recipe.
- Validate these roles at their real font sizes and weights. Ordinary text colors do not fade with
  structural Panel transparency; Disabled treatment remains a component-composition concern and
  is not represented by reusing Secondary.
- Neutral surfaces do not receive separate content-on roles. Workspace, Panel, Raised, Control,
  and Selected use Primary or Secondary Text as appropriate; Muted normally uses Secondary Text.
  Their surface recipes and validation must keep those shared text roles readable.
- Renderer variables such as card, popover, control, selected, and muted foregrounds are bindings
  to the smaller semantic text set, not evidence that each requires a public Theme role.
- Retain four symmetric solid-surface content roles: `Content on Accent`, `Content on Success`,
  `Content on Warning`, and `Content on Danger`.
- The corresponding Accent, Success, Warning, or Danger value is the actual solid substrate. Do not
  add a second `Solid Accent` color or a conditional recipe that silently darkens particular hues.
- Each content-on role is paired with that substrate and may be overridden in Advanced. A tint
  foreground and content on a solid semantic surface remain different roles.
- `Content on Accent` is consumed by primary actions and `Content on Danger` by destructive actions.
- Existing copy-success states in `CopyableTextBlock` and the file-report Export trigger become
  short-lived solid Success controls that consume `Content on Success`.
- The unknown-loudness-layout marker and Audio Dropped indicator become compact solid Warning
  treatments that consume `Content on Warning`.
- Completed file-history rows remain neutral, History Truncated remains a Warning foreground/tint,
  and activity and measurement states are not recolored merely to create semantic consumers.
- Interface Success, Warning, and Danger also derive usage-specific foreground, tint, and border
  roles. Their base values serve directly as solid substrates. Existing hard-coded Badge variants
  migrate to those Interface roles.
- Built-in Themes must meet the approved text-contrast gate. Custom Themes receive explicit
  warnings for unsafe combinations while retaining intentional override freedom.
- Advanced Interface uses one consistent grouping depth: `Surfaces`, `Text & Icons`, `Feedback`,
  `Contrast`, and `Effects` are siblings. `Text & Icons` contains Primary, Secondary, and
  Annotation; `Feedback` contains Success, Warning, and Danger text-and-icon colors used on
  ordinary or tinted feedback; `Contrast` contains Accent, Success, Warning, and Danger
  text-and-icon colors used on the corresponding solid backgrounds.
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

## Data, Meter, and module decisions

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

### Theme Editor presentation

- Keep `Core`, `Palettes`, and `Advanced` as the three primary tabs. Appearance is the compact
  Dark/Light control beside the Theme identity rather than a fourth tab.
- Advanced uses one level of collapsible sections: Interface, Activity, then modules in Module
  Catalog order. Module rows stay flat. Interface uses visible, non-collapsible subgroup headings
  rather than nested accordions.
- Advanced provides role search, shows each section's customized count, and offers a draft-local
  `Reset Section to Auto` action. Search temporarily reveals matching sections without replacing
  the user's prior expansion state.
- Keep short page and subgroup explanations visible. Move each individual role's description from
  a second text line into the existing themed HoverTip behavior, revealed on pointer hover and
  keyboard focus. Associate the control with an equivalent hidden description for assistive
  technology; tooltip content wraps to a bounded width and is not the sole accessible source.
- Use one shared 20 px square Theme Editor swatch beside labels in Core, simple Palettes, Intensity
  stops, and Advanced. It has the same radius and Theme Border treatment everywhere. Gradient
  preview strips and the Theme Picker's composite preview are different controls and do not inherit
  the square-swatch geometry.
- The HoverTip itself must use Interface Border rather than the current fixed white border.
- Preserve both preview forms against the same editor Draft. Existing Live Preview automatically
  publishes the Draft to the user's current real Workspace. An optional `Open Theme Preview`
  presents controlled `Overview` and `Modules` scenes for roles, modules, and states absent from the
  current Workspace.
- Theme Preview is read-only with respect to Workspace data and layout and renders only while open.
  It does not create another editor transaction: the existing Save commits the shared Draft and
  Cancel restores the prior Theme and closes or restores the preview.
- Editor validation distinguishes blocking structural or compilation errors from non-blocking
  visual warnings. A warning never silently changes a color and does not prevent a local Theme from
  being saved.
- Advanced shows a deduplicated warning summary with jump targets, per-role warning indicators, and
  warning counts on collapsed sections. Warning details name the related roles, measured value,
  recommended target, and representative affected consumers.
- Initial inline analysis is limited to high-confidence checks: text/content contrast, feedback
  contrast, important data and snapshot separation, Status and Frequency distinction, Intensity
  ordering and endpoints, and obvious surface collisions. Platform composition, animation, thin
  crossing traces, full color-vision simulation, and native effects remain gallery checks.
- Built-in Dark and Light may not ship with an accepted high-confidence warning. Local custom Themes
  retain intentional freedom. Community publication receives the same structured report; which
  severe warnings eventually block publication remains a later catalogue-policy decision.

### Module roles across normal and Dock surfaces

- A normal panel and its Dock representation share the same semantic module roles by default.
  Dock may resolve substrate-specific contrast internally, but it does not create a parallel public
  color system merely because its geometry and density differ.
- Module-local Status overrides therefore apply to the matching Dock module where it presents the
  same measurement meaning. Application activity and feedback that currently borrow
  `--ui-signal-*` migrate to Activity or Interface roles instead.
- Resolve the seven currently unconsumed published bindings explicitly: remove the inapplicable
  Loudness Selection Canvas binding and Spectrum Grid Canvas binding; connect the retained
  Loudness Grid and Spectrum Grid CSS bindings; connect Stereo Map Grid and Waveform Grid Canvas
  bindings; and connect Waveform Selection through its selector and painter instead of borrowing
  Loudness Selection.
- Removing an inapplicable renderer binding does not remove the semantic role. Every retained
  Advanced control must nevertheless have at least one real product consumer and a contract test
  proving the affected surface or state before the public format freezes.

### Public roles and internal resolution

- Retain Role, Recipe, Dependency, Reference, and Binding as distinct concepts. The problem is not
  their existence but their currently implicit layering.
- A public override role must be a visible Advanced option, be understandable without renderer
  knowledge, have a real or immediately committed consumer, retain stable meaning across renderer
  refactors, be independently gallery-testable, and have an explicit migration path.
- Public role IDs are semantic targets such as `waveform.frequencyLow`; internal roles such as
  `data.snapshot.primary`, `data.selection`, `data.grid`, and `meter.safe` are compiler nodes and do
  not become portable fields merely because they exist in the registry.
- Rename semantic IDs before format freeze where current implementation language or superseded
  terminology leaks through: Status Good becomes Safe, Interactive Surface becomes Selected
  Surface, Interface Critical becomes Danger, and Spectrogram Ink and Surface Ink become
  Monochrome Lines and Monochrome Surface.
- Keep concise module IDs such as `waveform.trace`; adding a `module.` prefix provides no semantic
  value.
- References are an explicit public allowlist per override role, not arbitrary graph edges. Initial
  public reference sources are stable Core and Palette authoring sources. Internal derived roles do
  not appear in Follow menus or shared documents.
- The registry may remain one canonical inventory, but its shape must visibly separate public
  override metadata, internal resolution metadata, and renderer bindings. Recipe, Dependency, and
  Binding data are never serialized into a shared Theme.

### Auto, Follow, and Custom semantics

- `Auto` means no stored override. The role follows its versioned default recipe and may adopt an
  explicitly migrated recipe improvement in a future semantic compiler version.
- `Follow` is stored user intent. It binds the target role to an approved public Core or Palette
  source and continues to follow that authored value even if the target role's future Auto recipe
  changes.
- `Custom` stores a local authored color for the target role and is unaffected by later edits to
  the former source. Returning to Auto deletes the stored override rather than serializing the
  current resolved output.
- Auto and Follow may resolve to the same color today without being redundant. The editor keeps
  both because one accepts the module's evolving default and the other pins the semantic source.
- Initial public References do not chain through other Advanced override roles. Restricting sources
  to stable Core and Palette roots avoids reference cycles, fragile cross-module coupling, and
  internal graph leakage.
- A migration renames both override targets and Reference sources when their semantic IDs change.
  A removed or reinterpreted source must produce an explicit migration or actionable incompatibility
  error; it must never silently fall back to Auto.
- The editor shows the resolved swatch for every mode and identifies an explicit Follow source.
  Shared documents serialize only Follow and Custom overrides, never Auto or resolved recipe
  results.

### Validation and migration boundaries

- Theme ingestion follows an explicit pipeline: parse, shape validation, version migration,
  current registry compatibility validation, compilation, then visual and accessibility analysis.
- Schema validation owns document shape, declared versions, required fields, primitive types, color
  syntax, numeric ranges, and identifier syntax. It does not invent missing semantic values or
  inspect renderer bindings.
- Migrations own every meaning-changing compatibility step. They are deterministic, ordered by
  version, and return migration notes or actionable incompatibilities where intent cannot be
  preserved.
- Registry compatibility validation owns whether an override target is public, whether its mode is
  allowed, and whether a Reference source is on that target's explicit compatibility allowlist.
  It reports all relevant issues together rather than failing on the first compiler exception.
- Compiler validation owns dependency resolution, recipe input and output kinds, complete role
  resolution, and complete unique renderer bindings. The compiler remains defensive but is not an
  implicit migration engine.
- Visual and accessibility analysis reports contrast, distinguishability, grid visibility, and
  related quality warnings. Unsafe Custom choices may remain intentional; those warnings do not
  masquerade as structural schema errors.
- Remove the current Interface-palette backfill from ordinary V2 normalization. The explicit
  migration retains measurement Status, maps old Status Good to Safe, seeds new Interface Success
  and Warning from the corresponding old Status values, and maps old Interface Critical to
  Interface Danger. It records each compatibility decision.
- Invalid colors, unknown public roles, forbidden Reference sources, unresolved graphs, and
  unsupported versions are errors. Contrast and visual-quality findings are warnings unless a
  stricter built-in-Theme release gate applies.

### Format and semantics versioning

- Replace the overloaded single public version with two protocol-owned integer fields:
  `formatVersion` describes how to parse the document and `semanticsVersion` describes how Auto
  recipes are interpreted. Neither is the PLVS application version or a package SemVer.
- Format migrations handle structural changes such as Good to Safe, Interface Critical to Danger,
  Palette shape changes, and override representation changes.
- Semantics migrations handle changes that can alter a resolved Theme without changing its stored
  fields, such as new surface, snapshot, grid, or contrast recipes.
- Migration preserves authored Core and Palette values, Custom values, and compatible Follow
  relationships. Auto remains Auto and adopts the explicitly documented corrected rule for the new
  semantics version; migration does not manufacture Custom overrides merely to preserve an old
  recipe result. A deliberate value or Reference that cannot be mapped safely is an actionable
  incompatibility rather than a silent fallback.
- Local persisted Themes migrate deterministically without a blocking startup dialog and retain a
  structured, inspectable migration note. Import of an older shared Theme presents migrations and
  adaptations in the import preview before mutation.
- Changing an Auto recipe without incrementing and migrating `semanticsVersion` is forbidden. The
  migration report identifies meaning-changing steps; it does not silently reinterpret a shared
  document.
- Import order is format migration, semantics migration, current registry compatibility
  validation, compilation, then visual analysis.

### Theme color and surface composition

- Separate four layers: opaque authored Theme colors; opaque compiler-resolved semantic surfaces;
  product-owned composition tokens such as opacity, blur, highlight strength, and shadow geometry;
  and runtime environment choices such as the user's Panel Opacity and native Glass.
- Theme colors answer what material or semantic color a surface has. Design tokens answer how that
  material is painted. The final composited pixel is environment-dependent output and is never
  written back into the Theme document.
- Native integration is an appearance adapter, not a public color family. The Theme provides its
  Dark/Light appearance intent; Windows and macOS own outer-window clipping, native shadow, and
  platform material rendering. PLVS Theme continues to own every WebView, CSS, SVG, and Canvas
  surface inside that native container.
- The tray menu is PLVS-designed in content, ordering, checked and enabled state, and behavior, but
  Tauri `Menu`, `Submenu`, `MenuItem`, and `CheckMenuItem` are rendered by the operating system.
  Theme may select an appropriate tray icon and appearance hint; it does not promise menu
  background, hover, typography, checkmark, radius, or shadow colors.
- Registry-native color bindings remain internal and empty until a concrete controllable native
  consumer exists. Architecture documentation must not describe native colors as complete merely
  because the compiler carries `colorScheme`.
- Core, Palette, and ordinary Advanced color inputs remain opaque. Theme Editor color controls do
  not expose alpha for them. Effect and compositor opacity stays system-managed.
- Component classes do not invent local `/55`, `/85`, fixed RGBA highlight, or similar surface
  composition. Named composition tokens apply transparency at explicit surface boundaries and
  avoid recursively fading Workspace, Panel, child Control, and Border.
- Build a fully opaque structural-surface variant as the first validation baseline. Workspace,
  normal panels, headers, footers, controls, muted and selected surfaces, popovers, and dialogs use
  opaque resolved colors; backdrop blur and saturation are disabled for those surfaces in this
  variant.
- `Fully opaque` does not ban alpha from directional shadows, the approved modal scrim,
  anti-aliasing, data-area fills, disabled-state emphasis, or transparent pixels outside a rounded
  native window. Those are effects or geometry rather than structural surface colors.
- The opaque baseline is an experiment, not a final visual decision. The gallery compares it with
  the current translucent implementation and a hybrid variant in which ordinary structure stays
  opaque while explicitly floating or native-environment surfaces may composite.
- The opaque baseline runs with Panel Opacity at 100 percent. The later matrix separately tests the
  user opacity preference so the product can decide whether it remains a supported compositor
  control, changes scope, or is retired.
- Hide Chrome changes native decorations but does not redefine Theme or compositor semantics. On
  the reviewed Windows configuration, the normal borderless main window retains the system-owned
  rounded clip and native shadow, so PLVS should not add a duplicate root radius or transparent
  padding merely to recreate that silhouette.
- The opaque Workspace may fill the main WebView and rely on the verified native clip. Maximized
  and fullscreen states must remain edge-to-edge, and Windows and macOS gallery coverage must
  confirm that rounded clipping survives the opaque baseline before this becomes a cross-platform
  guarantee.
- Dock remains a distinct window-shape case: Dock mode removes native decorations and shadow, so a
  transparent window exterior may still be required around its explicitly drawn visible shell.
- The current `panelOpacity` setting is not one coherent panel compositor control. It directly sets
  Workspace opacity, multiplies Panel and Header backgrounds by different constants, fades borders,
  Dock and fullscreen backgrounds, and also fades Level Meter and Spectrogram data with a separate
  floor. It therefore mixes window transparency, structural hierarchy, and data visibility.
- Remove data, text, focus, semantic state, and measurement marks from the opacity setting's scope.
  They remain fully legible regardless of structural-surface composition.
- The opaque baseline removes the current `P * 0.55` Panel and `P * 0.60` Header behavior and runs
  structural surfaces at 100 percent. It tests the semantic surface recipes without blur, fixed
  highlights, or accidental Workspace blending.
- Do not decide the future slider merely by renaming it. Gallery comparison determines whether the
  product retains a coherent Window Transparency or Surface Transparency control, replaces it with
  named compositor modes, or removes it.
- `panelOpacity` is persisted in settings, saved Views, Presets, and Agent Control. Any replacement
  therefore requires an explicit view-state migration and synchronized public control contract; an
  old numeric value must not be silently reinterpreted with materially different visual meaning.
- In the opaque baseline, Workspace uses Workspace Color; normal Header, Footer, and module panels
  use Panel; floating Header and Footer, popovers, tooltips, dialogs, and editors use Raised;
  interactive controls use Control; de-emphasised regions use Muted; and selected controls use
  Selected. Panel content inherits its parent instead of adding another background layer.
- Opaque hierarchy is established in order: validate Workspace-to-Panel separation, then Border,
  Raised Surface plus Shadow, Control affordance, Muted de-emphasis, and Selected recognition.
  Blur or highlight is reconsidered only after those semantic layers are proven insufficient.
- Muted is not implemented by fading an entire component, and Hover is an internal opaque color
  derived from the relevant surface where possible. Fixed white inset highlights are absent from
  the baseline; any later highlight must be a named, scheme-aware product effect with an explicit
  purpose.
- The Dock window may keep transparent pixels outside its rounded visible shell, but the opaque
  baseline renders that shell as an opaque Raised Surface and lets internal modules inherit it by
  default.

#### Phase 5 implementation result (2026-09-24)

- The Dark and Light Product Gallery was captured before and after the opaque experiment under
  `artifacts/theme-gallery/phase5-current-translucent` and
  `artifacts/theme-gallery/phase5-opaque-experiment`. The empty-shell comparison changed 88.42%
  of Dark pixels and 88.52% of Light pixels, confirming that the old fixed-alpha composition was
  affecting the whole structural hierarchy rather than a small decorative detail.
- Product review retained the continuous slider and chose **Surface Opacity**. It remains a 0–100
  percent View control; 100 percent is the deterministic opaque baseline. It applies once to the
  Workspace, normal Header/Footer, panel, fullscreen, file-summary, and Dock shell fills.
- Text, borders, controls, focus, semantic state, SVG/Canvas data, and measurement marks are outside
  the slider's scope and stay opaque. Floating overlays and editors use opaque Raised surfaces.
  Backdrop blur, saturation, fixed inset highlights, and the former `P * 0.55` / `P * 0.60`
  multipliers are absent from the structural baseline.
- The internal and Agent Control field is renamed from `panelOpacity` to `surfaceOpacity`.
  Settings, Presets, and configuration-profile import explicitly translate the old field on read;
  new writes and exports use only `surfaceOpacity`. The numeric value is retained so the user's
  expressed transparency preference is not discarded, while the new name makes the narrower
  rendering contract observable instead of silently redefining the old public field.
- Hide Chrome changes only native decorations, fullscreen uses the same Workspace composition,
  and Dock applies the control to its single Raised shell while modules inherit it. Windows is the
  available native-composition baseline for this phase; macOS native Glass remains a required
  platform-specific gallery check before changing that adapter.
- The implemented baseline completed the Dark/Light Product Gallery at
  `artifacts/theme-gallery/phase5-surface-opacity`. Focused Windows captures at 35 percent cover the
  normal shell, Hide Chrome, and the 82 px Dock shell; their text, borders, controls, state marks,
  and measurement renderers remain opaque while the structural fill composites with the native
  window. The gallery runner now forces and verifies `surfaceOpacity: 100` for reproducible standard
  captures, then restores the user's initial value.

### Dark and Light visual evaluation order

- Evaluate Dark and Light independently; shared recipe structure does not imply that identical
  constants produce equivalent hierarchy or contrast in both schemes.
- Validate the opaque surface ladder first: Workspace, Panel, Raised, Control, Muted, and Selected.
  Then validate text and content contrast, data-series distinction, Palette behavior, and finally
  complete product scenes.
- Use 4.5:1 as the normal and small-text target, including compact annotations and axis labels;
  3:1 applies to large text and necessary graphical or control boundaries. Nonessential decoration
  is assessed separately from information-bearing marks.
- Exercise Primary, Secondary, Snapshot, Selection, Warning, and Critical together. Secondary is
  not visually demoted by name; state colors do not replace series identity where the design keeps
  a normal series color.
- Status evaluation covers meter gradients, small markers, rule-result text, and continuous module
  encodings. Frequency evaluation covers anchor distinction, interpolation, neutral fallback, and
  avoidance of unrelated state meaning. Intensity evaluation covers monotonic energy reading,
  quiet-detail retention, strong-signal emphasis, and 2D/3D consistency.
- Product scenes cover Empty, Live, File, Snapshot, Selection, Warning, Critical, Disabled, Hover,
  keyboard focus, dialogs, popovers, Dock, Hide Chrome, fullscreen, representative sizes and
  channel topologies, and Windows and macOS.
- Composition is assessed in order: opaque baseline, redesigned translucent candidate, then native
  Glass. A later effect cannot be used to approve an inadequate opaque semantic model.
- Current measured failures remain baseline evidence rather than accepted targets: Dark content on
  Accent is about 2.02:1, Dark content on Critical about 3.20:1, Light content on Critical about
  4.00:1, Light Warning on Panel about 1.49:1, and Light Primary Data on Panel about 2.87:1.
- Treat the Dark Accent failure first as a built-in color-pair problem, not as evidence for a new
  Theme mechanism. Dark should choose one Accent that works acceptably both as an emphasis color
  on neutral surfaces and as a solid substrate for light `Content on Accent`.
- The compiler must not inspect a hue and conditionally substitute a darker solid variant. Custom
  Themes retain their authored Accent/content pair; analysis reports unsafe contrast without
  silently changing the colors or preventing ordinary save and use.
- Only if the gallery proves that one Accent cannot satisfy both jobs across the intended design
  should a separate solid-surface role be reconsidered. That decision requires evidence across
  multiple hues and both schemes rather than the current orange alone.
- Built-in Status and Interface colors share recognizable semantic hue families without sharing
  values or identity: Safe and Success are green-family, both Warnings are amber-family, and
  Critical and Danger are red-family. Measurement tuning must not move Interface feedback colors,
  and Interface tuning must not change meter encodings.
- Built-in Dark pairs solid Interface Success, Warning, and Danger with light content. Built-in
  Light pairs them with dark content. These are authored default pairs, not runtime hue detection
  or automatic darkening. Exact values remain a gallery decision.
- Accent and Primary Data remain independently editable even when a built-in Theme deliberately
  gives them the same orange value. Semantic independence does not require visual difference in
  the defaults.
- Retain the built-in orange Primary and blue-family Secondary direction as the first gallery
  candidate. Validate Primary, Secondary, Primary Snapshot, and Secondary Snapshot together at
  real line widths, crossings, and overlaps in both schemes and with color-vision simulations
  before changing exact values or snapshot recipes.
- Built-in Dark and Light Frequency palettes retain the same semantic hue families: Low is red,
  Mid is orange, and High is blue. Each scheme may tune lightness and chroma independently, but
  Light must not change Mid to purple merely to obtain contrast.
- Validate the Frequency anchors and their interpolation in Waveform and any other real consumer;
  pay particular attention to Low/Mid separation because both are warm hues. Exact values remain
  a gallery decision.
- Retain canonical Inferno as the initial built-in Intensity scale in both schemes so that intensity
  reading does not change with application appearance. Do not introduce a separate Light scale
  without gallery evidence.
- Validate its low and high endpoints, no-data and below-floor states, 2D/3D consistency, and Grid,
  Selection, and Axis Label overlays. The surrounding renderer treatment may differ by scheme even
  when the Intensity values remain identical.
- Retain the built-in Dark Status direction of green Safe, bright amber Warning, and red Critical.
  Built-in Light uses the same hue meanings but must replace the current bright Warning with a
  darker amber that remains visible on light panels. This is a default-value correction, not a new
  Theme mechanism.
- Validate Status values as thin rules, small markers, values, range boundaries, and gradients in
  Level Meter, Stats, Vectorscope, and Stereo Map. Status does not gain content-on roles; those
  belong to the separate Interface feedback semantics.

### Deterministic Theme gallery

- Build two complementary galleries. The Semantic Gallery presents controlled Role relationships
  and editor outcomes; the Product Gallery runs real PLVS renderers and proves actual integration.
  A synthetic gallery example never counts as a production consumer.
- Core Product scenes cover shell surfaces, controls, feedback, Level Meter, Loudness, Spectrum,
  Waveform, 2D Spectrogram, 3D Lines, 3D Surface, Vectorscope, Stereo Map, Stats, Dock, dialogs, and
  window modes.
- The mandatory matrix runs every core scene in built-in Dark and Light with the opaque compositor
  at a representative size. Focused matrices add compositor variants, narrow and wide modules,
  Dock heights, Spectrogram modes, topology, window modes, DPI, and platforms without expanding
  every dimension into an unreviewable Cartesian product.
- A versioned machine-readable manifest owns Theme ID or document hash, compositor, deterministic
  fixture and hash, workspace state, interaction state, viewport, scale, platform, expected Agent
  Control revision, covered public roles, and renderer surfaces.
- Capture waits for revision-correlated application readiness rather than an arbitrary sleep. The
  deterministic fixture and state transition path are shared across reruns.
- Outputs include individual images, comparison contact sheets or a local switchable gallery, and
  a machine-readable report containing metadata, contrast, perceptual distance, binding coverage,
  and pixel-difference signals.
- Every public Advanced role requires a real production consumer, a Semantic Gallery case, a
  Product Gallery case, and a binding contract test before format freeze.
- Pixel differences are diagnostic signals, not automatic visual verdicts. Approval considers
  contrast, OKLCH separation, redundant encoding, renderer correctness, and human review together.

## Agreed implementation sequence

1. Capture the current deterministic visual baseline and build the Semantic and Product Gallery
   harness before changing Theme behavior.
2. Reshape the contract and compiler boundary: separate format and semantics versions, correct
   resolved kinds, split validation responsibilities, and implement tested migrations.
3. Complete renderer ownership: add the agreed Interface and Activity roles, remove unapproved
   hard-coded colors, repair bindings, connect committed Grid and Selection consumers, and add the
   approved module-local overrides.
4. Reshape Theme Editor navigation, labels, grouping, swatches, HoverTips, search, reset behavior,
   warning presentation, and preview entry while preserving blocking Draft/Save/Cancel semantics.
5. Build and compare the opaque structural-surface baseline, redesign Panel Opacity and its
   migration, and verify Dock, Hide Chrome, fullscreen, and native composition boundaries.
6. Tune built-in Dark and Light values only after the model and consumers are correct, using the
   approved gallery and accessibility evidence.
7. Freeze the canonical portable document, converters, validators, round-trip behavior, and hash;
   later file and clipboard sharing routes consume that same contract.

Changes may be committed in coherent batches rather than one commit per discussion decision.

## Public Theme format freeze gates

The portable Theme format must not freeze until all of the following are true:

- every public or editable role has a real production consumer, Semantic Gallery case, Product
  Gallery case, and renderer-binding contract test;
- Theme Editor exposes no no-op control, and every retained committed Grid or Selection role is
  connected to its renderer;
- every production-visible color has a Theme owner or a small reviewed exception entry; normal UI,
  Activity, Interface feedback, data, measurement, CSS, SVG, Canvas, and Dock do not borrow
  unrelated semantic bindings;
- schema, migration, registry compatibility, compiler, and visual-analysis responsibilities are
  separated and return structured path-aware results;
- format and semantics migrations preserve explicit authoring intent, never silently fall back to
  Auto, and have representative CSS, SVG, Canvas, Dock, and appearance verification;
- canonical export, validate, import, and re-export are stable, and canonical content hashes are
  reproducible;
- desktop, CLI, repository validation, and future community validation share the same portable
  converters and validators;
- unknown required roles, references, modules, or unsupported versions cannot disappear silently;
- built-in Dark and Light pass the approved high-confidence warning gate, color-vision review, and
  human review across the mandatory deterministic gallery;
- Windows and macOS approve the relevant opaque, transparency, Dock, Hide Chrome, fullscreen, and
  native appearance cases;
- architecture, design-token, user, migration, and public-format documentation match the verified
  implementation.

The user-facing Theme Preview and the complete website Copy/Paste experience may follow the format
freeze, but the underlying deterministic galleries, canonical portable document, and shared
validation must already be reliable.

## Phase 1 implementation baseline — 2026-09-24

Phase 1 now has a versioned manifest and repeatable runner under `scripts/theme-gallery/`. This
implementation deliberately changes no Theme document shape, recipe, role, binding, built-in
color, product component, or Agent Control contract.

The runner provides two evidence paths:

- `npm run theme:gallery:semantic` compiles the real built-in Theme documents with
  `compileTheme`, renders fixed-size Dark and Light semantic sheets, and records machine-readable
  contrast results. It covers surface hierarchy, text hierarchy, content-on-color pairs, global
  data, snapshot and selection relationships, measurement Status, Frequency, Intensity, focus,
  border, and representative module-role relationships. SVG is retained beside PNG so labels and
  resolved values remain inspectable.
- `npm run theme:gallery:product` connects to the running development-identity application through
  the existing Agent Control CLI. It generates one deterministic 15-second stereo PCM fixture,
  analyzes it through the real FILE pipeline, selects Dark and Light through Theme Control, and
  captures revision-correlated real renderer output. The core product set includes the complete
  shell and Workspace, all eight Workspace modules, Spectrogram Heatmap, colorized 3D Lines, and
  monochrome 3D Surface. Focused history scenes exercise Snapshot and Selection rendering in
  Loudness, Spectrogram, and Waveform. It restores the prior Theme, Spectrogram controls, source
  posture, shared axes, and removes its own FILE session.

`npm run theme:gallery` produces both sets, comparison contact sheets, and `report.json` beneath a
caller-selected or timestamped `artifacts/theme-gallery/` directory. The report records commit,
platform, runtime, Theme, fixture identity and SHA-256, capture revision, measurement correlation,
actual pixel dimensions, artifact SHA-256, semantic coverage labels, and current focused-matrix
work still requiring additional capture. Generated evidence remains local and is intentionally
gitignored; the manifest and generator are the reproducible source.

The first Windows capture at design-close commit `08793e2c` reproduced the audit findings without
changing them: Dark and Light Control and Muted resolve identically; Light Accent/Primary Data on
Panel measure 2.873:1, Light Warning on Panel measures 1.486:1, and Light Secondary Text on Panel
measures 4.534:1. Real product captures also make the weak Light Spectrogram and Stereo Map marks
directly comparable with Dark. These are baseline observations for later tuning, not Phase 1 color
changes.

The manifest separates the mandatory core run from the focused matrix rather than forming an
unreviewable Cartesian product. Narrow/wide panels, Dock heights, channel topology, hover/focus and
disabled interaction, dialogs and popovers, Theme Editor, Hide Chrome/fullscreen, DPI, macOS, and
native Glass remain named focused cases. They must be promoted to automated scenes or captured by
the same metadata/report convention as the relevant platform or interaction harness becomes
available. A focused case is not represented as covered merely because a synthetic Semantic
Gallery example resembles it.

## Phase 2 implementation boundary — 2026-09-24

Phase 2 establishes the contract/compiler boundary without changing built-in colors, public role
names, renderer ownership, or default product output. The current authoring document now declares
`formatVersion: 1` and `semanticsVersion: 1`; the former single `version: 2` shape is accepted only
by an explicit migration. That migration returns structured notes and owns the historical
Interface Critical backfill. Ordinary current-shape normalization no longer invents a missing
palette.

The Role Registry now exposes resolved `valueKind` as `solidColor`, `colorEffect`, or `colorScale`.
Border, Input Border, and Shadow are effects rather than mislabeled colors. The executable recipe
catalog is the single source for recipe names, allowed input-kind signatures, output kinds, and
resolution behavior; both registry construction and compilation validate that contract. A color
override on an effect role replaces its color while retaining compiler-owned opacity, preserving
the approved authored-color/product-composition boundary.

Shape validation and current-registry compatibility validation are separate functions. Compiler
failures expose stable codes and paths for invalid registries, recipes, graphs, override intent,
and resolved values instead of relying only on generic exception text. Agent Control's strict
authoring contract and examples use the two version fields. These changes deliberately retain the
existing role vocabulary and legacy explicit effect override representation until the later
renderer-ownership and portable-format phases can migrate them with their full consumers.

## Phase 3 implementation boundary — 2026-09-24

Phase 3 completes renderer ownership without tuning built-in colors or reshaping the Theme Editor.
The authoring document advances to `formatVersion: 2`: Status Good is now Safe, Interface Critical
is now Danger, Interactive Surface is now Selected Surface, and the Interface Palette explicitly
contains Success, Warning, and Danger. Current-shape and legacy migrations own those renames and
the Interface seed decisions. Existing built-in color values remain unchanged for later
gallery-led tuning.

Application feedback and activity no longer borrow measurement Status bindings. Solid feedback,
tinted feedback, `LIVE`, `SNAP`, recording, history warnings, validation errors, and copy success
now resolve through Interface or Activity roles. The retained hard-coded production colors are the
crash boundary, which must render before Theme runtime is available, and the modal scrim. Shell
highlights and overlay shadows are internal compositions of Theme-owned Text and Shadow colors.
Border, Focus, and Shadow are the only public effect-color choices; Input Border, surface
highlights, neutral surface foreground aliases, effect opacity, and shadow geometry remain internal.
Legacy authored effect colors migrate while opacity returns to the compiler-owned recipe.

Measurement ownership is split by module. Level Meter Safe/Warning/Critical, Stats Warning and
Critical Values, Vectorscope Correlation Safe/Warning/Critical, Stereo Map Safe/Warning/Critical
Ranges, and the Warning/Critical range colors used by Loudness Profile traces each follow global
Status under Auto but can be overridden without recoloring another instrument. The normal and Dock
renderers share their module roles. Production source and tests no longer consume the ambiguous
`--ui-signal-good`, `--ui-signal-warn`, or `--ui-signal-bad` bindings.

The seven audited binding gaps are closed: Loudness and Spectrum render their CSS grid roles;
Stereo Map and Waveform render their Canvas grid roles; Waveform and Spectrogram render their own
Selection roles; and the inapplicable Loudness Selection and Spectrum Grid Canvas publications are
removed. Spectrogram's monochrome labels, Waveform's frequency-neutral and centroid labels, and the
new module roles use the approved public vocabulary.

The post-change Windows evidence is reproducible with the Phase 1 runner. Both
`theme:gallery:semantic` and the Agent Control-backed `theme:gallery:product` completed into the
local `artifacts/theme-gallery/phase3-renderer-ownership/` evidence directory. The inspected contact
sheets confirm Dark and Light compiler output, real module rendering, module grids, and local
Selection rendering. The evidence remains gitignored; the generator, manifest, role-contract tests,
and renderer tests are the committed baseline.

## Phase 4 implementation boundary — 2026-09-24

Phase 4 reshapes Theme Editor presentation and validation without changing Theme document shape,
compiler recipes, role bindings, built-in color values, or portable sharing. Dark/Light appearance
is now a compact control beside Theme identity. Core, Palettes, and Advanced remain the three
primary pages and use one shared 20 px Theme swatch. Long role descriptions moved from persistent
secondary rows into HoverTips with screen-reader descriptions.

Advanced follows Interface, Activity, then Module Catalog order. Interface is subdivided into
Surfaces, Text & Icons, Feedback, Contrast, and Effects. A search temporarily reveals matches
without replacing the author's expansion state. Each section reports its customized count and can
remove all of its draft overrides in one undoable Reset Section to Auto operation.

The editor analyzes the compiled Draft for high-confidence contrast, data/snapshot, status,
frequency, surface, and adjacent-intensity risks. Results are structured non-blocking visual
warnings with metrics, affected consumers, per-role indicators, and navigation back to a relevant
control. Structural compiler failures remain the separate blocking validation class. Local custom
Themes may still be saved with warnings; built-in Theme warning gates and color tuning remain later
phases.

`Open Theme Preview` renders Overview and Modules scenes from the same in-memory Draft and resolved
CSS bindings as the editor. It is read-only with respect to Workspace data and layout, owns no
second draft or transaction, and disappears with the editor. The preview covers semantic surfaces,
text/content pairs, feedback/activity, measurement status, all eight Workspace modules, and the
Intensity scale; the real Workspace continues to receive the existing live Draft publication.
