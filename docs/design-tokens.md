# Design Token Specification

PLVS desktop UI components, Theme bindings, and layout tokens. The
[website design system](website-design.md) has its own reference.

## Where to start

- For a desktop control or floating surface, start with [Buttons](#buttons), [Selects](#selects),
  [Tooltips and Popovers](#tooltips-and-popovers), or [Dialogs](#dialogs). Look for an applicable
  component in `src/components/ui/` or an existing use of the same interaction.
- For layout and sizing, use [Scaling with Interface Size](#scaling-with-interface-size),
  [Control Height](#control-height), [Typography Tokens](#typography-tokens), and
  [Spacing Tokens](#spacing-tokens).
- For appearance, use [Color Tokens](#color-tokens), [Shadows](#shadows),
  [Radius Tokens](#radius-tokens), [Focus](#focus), and [Motion](#motion).
- For specialized surfaces, see [Dock Tokens](#dock-tokens) and
  [Dataviz Style Tokens](#dataviz-style-tokens).

## Changing desktop UI

1. **Find the closest existing interaction.** Read its caller and the shared component it uses.
   Reuse the component where its behavior fits. Start with a documented variant, then use
   caller-owned layout for placement and sizing.
2. **Change the owner.** A local arrangement belongs in the caller. A change to shared behavior
   belongs in the component. A Theme role, Interface Size profile, or rendering recipe belongs in
   the source named under [Architecture](#architecture).
3. **Verify the states your change affects.** For layout, check the narrowest relevant width,
   long labels, and larger Interface Size profiles. For appearance, check Light and Dark. For
   interaction, exercise the relevant pointer and keyboard states, including how an overlay opens
   and dismisses. Follow the [Agent Control workflow](../AGENTS.md#agent-control) and the
   [rendering comparison procedure](pitfalls.md#rendering-changes) when reviewing changed pixels.

Keep this reference current with shared UI changes. Use the implementation on `main` for current
behavior. Document component selection, the source of each shared rule, and any intentional
exceptions. Update the affected section when its rule changes.

---

## Architecture

Consume resolved semantic tokens, PLVS component tokens, or the resolved renderer bundle.
Keep raw palette values and color derivation in the Theme compiler.

```
Authoring    Six Core Colors, purpose-specific Palettes, and sparse Advanced overrides.
             Builtins live in builtinThemesV2.js; custom documents use the same schema.

Resolved     themeRoleRegistry.js defines every meaningful visible role, its value kind, and its
             dependencies. themeRecipes.js owns executable typed recipe contracts. compileTheme.js
             produces one complete immutable CSS / Canvas / effect contract. Chart fill opacity
             is fixed product composition in src/lib/chartFill.js (ADR 0019).

Bindings     themeRuntime publishes semantic CSS tokens, component colors, and renderer values.
             src/preferences/data.js holds the Small layout baseline. interfaceSize.js resolves
             the selected profile, and applyLayoutToDocument() publishes layout and tuning tokens.
             index.css derives shared geometry and state styles. src/dock/dockTokens.css owns
             strip-specific spacing and control geometry.
```

---

## Focus

Tab sets `data-keyboard-nav` through `src/lib/keyboardNavigation.js`. The next pointer press clears
it. `index.css` suppresses the browser's default outline and paints a shared 2px `--ring` outline
on `:focus-visible` when the attribute is set. The same gate applies to keyboard focus styles
derived from a button's neutral hover fill or foreground color.

Use the shared ring for focus indication. `src/components/ui/themeColorContract.test.js` rejects
component-local `focus-visible:ring-*` and `focus-visible:outline-*` utilities.

`interface.focusRing` supplies `--ring`. Its automatic value follows the Theme's Interface Accent;
Theme authors can override it under **Advanced → Interface → Effects → Focus Ring** when the
automatic ring needs more contrast. Menu and list keyboard highlighting is a background change
(`focus:bg-ui-hover`) and is unaffected.

## Annotation Text

`interface.text.annotation` publishes `--ui-text-annotation`. It is the compact technical-text
role: chart axes, units, channel/mode labels, hover HUD readouts, and other labels that annotate a
measurement. Explanatory copy and supporting UI labels stay on `interface.text.secondary`.

The 3D spectrogram cannot inherit a DOM text colour, so its `spectrogram.axisLabel` canvas role
follows Annotation Text by default. Other axes and technical labels consume the CSS token directly.

PLVS has three UI text colors: Primary (`foreground`), Secondary (`muted-foreground`), and
Annotation (`--ui-text-annotation`). Disabled is a 50% state applied once to the whole control, not
a fourth text color. Do not create local `/N` text or icon variants to manufacture extra hierarchy;
if these roles stop being sufficient, add a new role through a separate design decision.

## Scaling with Interface Size

Size text containers using intrinsic layout, font-relative units, or a shared profile width.
Fixed widths in `px` or `rem` stay constant as Interface Size increases the type scale.

| Situation                    | Use                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Column holding a known label | `w-[calc(<label>em + <padding>rem)]` — the em share covers the text and any icon, the rem share the padding and gaps                                  |
| Numeric field                | `w-[7ch]` — `ch` follows the font                                                                                                                     |
| Column holding a short unit  | `w-[3.2em]`                                                                                                                                           |
| Chart axis rail              | `max(<px floor>, calc(var(--ui-fs-axis) * <ratio>))`, as `--ui-chart-y-axis-rail-w` already does                                                      |
| Floating editor panel        | `--ui-editor-w`, set by Interface Size; `--ui-editor-height-cap` (600px) and `--ui-editor-max-h` (at most 80vh) share the Theme/Profile height policy |

Use [Control Height](#control-height) for fixed-height rows and controls.

Text surfaces use shared preferred widths in CSS pixels. All widths are bounded by the available
viewport (or the monitor for native Dock hosts); menus retain intrinsic widths rather than filling
their maximum. `layout.surfaces` in the Interface Size profiles owns these values:

| Token                    | Small | Default | Large | Extra Large | Used by                                                               |
| ------------------------ | ----: | ------: | ----: | ----------: | --------------------------------------------------------------------- |
| `--ui-surface-compact-w` |   288 |     320 |   368 |         416 | Welcome, confirmation dialogs, Feedback, library menu limits          |
| `--ui-surface-dialog-w`  |   384 |     448 |   512 |         576 | Import/export, saved-item selection, save conflicts, Dock menu limits |
| `--ui-surface-wide-w`    |   480 |     544 |   608 |         672 | Update details and crash reports                                      |
| `--ui-surface-status-w`  |   320 |     384 |   432 |         480 | Status lists                                                          |

Settings uses `--ui-drawer-w`, and Theme/Profile editors use `--ui-editor-w`. See the
[profile matrix](#interface-size-profiles) for their widths. Native Dock content receives the
same surface widths even where its chrome stays compact.
Intrinsic Dock menus must not use viewport-relative width limits, since the native host follows
their measurement. Authoring windows request their profile's preferred width rather than their
currently clipped content width, so forms can both grow with Interface Size and fit a small monitor.

## Grid Lines

Every optional panel Grid and every always-visible Vectorscope guide resolves from `data.grid`.
The default recipe mixes the resolved Panel Surface 8% toward white in Dark or black in Light,
independently from interface Border. Render the resolved color directly at full opacity.
`src/components/ui/themeColorContract.test.js` guards this separation.

Optional Grid is available in Loudness (Y axis), Spectrum (X and Y axes), Stereo Map (a separate
choice for each mode), and the two 3D Spectrogram modes (one shared choice). It defaults off. The
Vectorscope's orientation geometry is classified as Guides and stays visible. Waveform has neither
a Grid nor a centre reference line. Stereo Map has no unconditional zero reference line.
Dock's shared Loudness, Spectrum, and Stereo Map panels carry their Grid controls through
`src/dock/dockModuleControls.js`.

Draw grid lines at 1 CSS px to preserve the resolved line weight.

## Shadows

`interface.shadow` publishes `--ui-shadow-color`. Product surfaces use three elevation levels:

- **Flat:** no shadow. Workspace panels, Dock modules, shell chrome, controls, ordinary cards and
  chart HUDs live here.
- **Raised:** `shadow-raised`. Tooltips, popovers, dropdowns, panel settings, drag previews, toasts
  and the file-drop prompt use it.
- **Modal:** `shadow-modal`. Settings, editors and dialogs use it.

Raised and Modal own their geometry and strength in `index.css`; components do not choose from a
shadow-size ladder. Both take their color from the Theme-owned Shadow role.

A shadow has to be darker than what it falls on, so it cannot simply track a core colour: on a
light theme the workspace is the palest thing there is. The recipe takes whichever of `workspace`
and `text` is darker — workspace on a dark theme, text on a light one — which keeps it dark while
still letting the theme tint it. The colour scheme sets the weight: 50% on dark, 18% on light.
Contrast outlines around the color picker and recording indicator are not elevation and remain
local to those components.

## Structural Surface Opacity

Surface Opacity controls window composition. `--surface-opacity` drives
`--ui-surface-workspace` and `--ui-surface-panel` for the normal workspace, shell, panels,
fullscreen, and File Summary. Dock has its own `--dock-surface-opacity`, consumed by
`--ui-surface-dock`. Both settings default to `100%`. Apply the resolved fill once at the
structural boundary.
Do not apply it to a parent with CSS `opacity`, multiply it by a local fixed alpha, or route borders,
controls, typography, focus/state marks, Canvas, or SVG measurement data through it. Raised
overlays and editors remain opaque so their content has a stable reading surface.

At `100%`, the authored semantic hierarchy is the deterministic visual baseline. Lower values
expose the native window compositor without weakening the foreground information layer.

## Modal Scrim

Dimmed modals and the file-drop target use the shared `SCRIM_CLASS` in
`src/components/ui/surfaceStyles.js`. It applies 60% black across Themes. The Settings Sheet adds
`backdrop-blur-sm` to the scrim and keeps the drawer opaque. Theme Preview uses an unpainted modal
overlay while temporarily hiding its editor. Use the shared [layer constants](#layers).

## Control Height

Interface Size sets `--ui-control-h`. The other control heights derive from it in `index.css`.

| Token            | Small / Default | Large | Extra Large | Used by                                                                                                                                                                                 |
| ---------------- | --------------- | ----- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ui-control-h` | 24px            | 28px  | 32px        | Form controls: text buttons, the add control, text and number inputs, the shortcut key cap, all select variants, a panel's choice rows, and the rows and labels that align to a control |
| `--ui-shell-h`   | 28px            | 32px  | 36px        | Shell chrome and dropdown options: header icon buttons, Source Transport, the panel header bar, popover title bars, the options of an open select                                       |
| `--ui-row-h`     | 32px            | 36px  | 40px        | List rows: every row of a menu, picker or managed list, whether the row itself is the click target (`MenuRow`) or holds a `RowAction` beside a handle and trailing actions              |
| `--ui-switch-h`  | 16px            | 18px  | 22px        | Every switch; its width and thumb are derived from it. Two thirds of the control height, rounded to 2px                                                                                 |

Use these heights for the listed controls. Multiline fields size to their content.
`src/components/ui/controlHeightContract.test.js` rejects
a fixed height above 24px written in a class string, and checks that the shared primitives read
these tokens.

## Buttons

Choose the primitive by the button's role and placement.

| Primitive    | Where                           | Use                                                                                                                                    |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`     | `components/ui/button.jsx`      | Text actions at Control size or square icon actions with `size="icon"`. Both use the control height                                    |
| `IconButton` | `components/IconButton.jsx`     | Shell-level icon actions with a neutral hover fill and a tooltip                                                                       |
| `IconAction` | `components/ui/icon-action.jsx` | Icon actions inline in a row or header. Colour change only; panel header actions add a hover fill through `PANEL_HEADER_ACTION_BUTTON` |
| `LinkButton` | `components/ui/link-button.jsx` | Text that reads as a link: no box, Secondary text that turns Primary on hover                                                          |
| `MenuRow`    | `components/ui/row.jsx`         | A full-width row that is itself the click target: menu items, picker options, disclosure headers                                       |
| `RowAction`  | `components/ui/row.jsx`         | The main click target of a row whose container paints the hover and holds a handle or trailing actions                                 |
| `TabButton`  | `components/ui/tab-button.jsx`  | One tab in an underlined tab strip                                                                                                     |
| `DragHandle` | `components/ui/drag-handle.jsx` | The grip that starts a reorder or placement drag                                                                                       |
| `AddButton`  | `components/AddButton.jsx`      | The dashed "add a new item" slot                                                                                                       |

`Button` variants are Primary (`default`), `secondary`, `ghost`, `quiet`, `outline`, `destructive`,
and `link`. Use `quiet` for low-emphasis controls with muted idle text and a neutral highlight.
A dialog's dismissing action is `ghost`. Its confirming action is Primary or `destructive`.

The [app header](../src/components/AppHeader.jsx) uses `IconButton` for shell-sized actions with a
built-in tooltip. The [Files menu](../src/components/FileAnalysisHistoryMenu.jsx) uses
`Button size="icon"` for its control-sized popover trigger and `IconAction` for a trailing row
action. Use these placements to choose among the three icon action shapes.

Each primitive owns only what every use shares. Padding, font size and state colours that depend
on where it sits are passed as `className`.

`src/components/ui/rawButtonContract.test.js` lists every hand-written button that remains, each
with its reason, and fails when a new one appears. A one-off control stays hand-written; a second
control of the same kind is the signal to add a primitive.

## Selects

`SelectTrigger` and `SelectContent` in `src/components/ui/select.jsx` take a `variant`, and a call
site passes the same one to both. All three take the control height; `inline` and `flush` differ only in edge treatment, and `field` is one text size smaller; a call
site does not restyle one with its own class string.

| Variant  | Text              | Used by                                                                                                                        |
| -------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `inline` | Control           | Values inside a popover, dialog or editor row: panel settings, Focus View, the Loudness Profile editor, the close confirmation |
| `flush`  | Control           | Settings rows; no right padding, so the chevron sits on the row's right edge                                                   |
| `field`  | Metric Annotation | The Theme Editor's denser rows                                                                                                 |

All three are transparent at rest and take the neutral hover fill; the shared field rule in
`index.css` reveals the border on keyboard focus and while the menu is open. Width, column sizing
and a surface-specific text colour stay with the caller.

## Tooltips and Popovers

- Use [`HoverTip`](../src/components/HoverTip.jsx) for brief, passive help. Use
  `useHoverTip` when an existing element needs to be the anchor. Keep the control's accessible
  name on the control itself. In-app tooltips use this shared themed surface in place of a
  native `title` tooltip.
- Use [`TruncatingLabel`](../src/components/TruncatingLabel.jsx) for a single line with an end
  ellipsis. It reveals the full label on hover only when the text is clipped. For a custom label,
  `useTruncationTip` can measure the clipping element, or `useHoverTip` can display the result of
  a custom clipping check.
- Use [`Popover`, `PopoverTrigger`, and `PopoverContent`](../src/components/ui/popover.jsx) for
  anchored menus, settings, or details the user can keep open. `PopoverContent` owns the shared
  surface, layer, and default positioning. File Summary details use
  [`FileDetailPopover`](../src/components/FileDetailPopover.jsx) for hover preview and click to
  keep the details open. Their content uses the same compact padding as `HoverTip`,
  `0.5rem` on each side and `0.25rem` above and below.

When information is needed to identify an item or complete an action, provide a visible or
keyboard-accessible way to reach it. Use hover for optional help or to reveal text whose full
content is already available to assistive technology.

## Layers

Everything that floats above the workspace takes its z-index from a named constant in
`src/components/ui/layers.js`. A surface states what it must sit above instead of choosing a number.

| Constant             | Used by                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `LAYER_FLOATING`     | Popovers, menus, tooltips, the Settings sheet, floating editors, drag previews, ordinary dialogs |
| `LAYER_ABOVE_EDITOR` | A confirmation raised from a floating editor                                                     |
| `LAYER_PRIORITY`     | Theme Preview, the crash report, transfer status                                                 |
| `LAYER_CONFLICT`     | The cross-workbench Library conflict                                                             |
| `LAYER_INDICATOR`    | Passive indicators such as the recording mark                                                    |

Within one layer, DOM order decides, so a menu opened inside a dialog covers it without a layer of
its own. Panels and the shell keep small local values below 50 for their internal stacking; those
are not layers. `src/components/ui/layersContract.test.js` rejects a z-index of 50 or more written
anywhere else.

## Dialogs

Modal dialogs render through `DialogContent` in `src/components/ui/dialog.jsx`, which owns the
scrim, layer, centring, Modal surface, `rounded-xl` and `p-3` padding. Width follows Interface Size:
`sm` uses `--ui-surface-compact-w`, `md` (the default) uses `--ui-surface-dialog-w`, and `lg`
uses `--ui-surface-wide-w`. These widths leave a 1rem margin on each side of the viewport.
With `size="custom"`, the caller owns the width and its cap. `DialogTitle` uses the Control size in
semibold, `DialogDescription` the Metric Annotation size in Secondary text, and `DialogFooter`
right-aligns actions with a `gap-2`, adding a rule above them when the body scrolls.

Draggable, non-modal windows (the Theme and Loudness Profile editors, the feedback form) share
`FLOATING_WINDOW_CLASS` from `surfaceStyles.js` and add only their own width and height.

## Highlight States

Hover, keyboard focus, pressed buttons, and open configuration entries use neutral feedback.
Transparent controls use `--ui-neutral-hover`, an opaque mix that moves Muted 6% toward Primary
Text so the state gains contrast in either colour scheme. Open menus
retain their trigger highlight until closed; active configuration does not brighten a closed
entry. Select options paint the same neutral fill for native pointer hover, Radix highlight, and
keyboard focus. Auxiliary actions may change only their text color. Filled action buttons retain their
own opaque derived Hover colors. No state requires an outer focus ring or scale animation.

Small persistent marks use Primary: single- and multi-choice checks, checked switch tracks,
and slider progress. Switch hover/focus adds an inset Border stroke to the thumb. Slider
hover/focus fills the thumb with Neutral Hover; active adjustment fills it with Primary.
Dark / Light segmented selection uses a neutral fill and primary text, not the Accent surface.
Selected Surface and its foreground role are retired; legacy overrides are removed at theme ingress.

Ordinary fields hide their border at rest while reserving its space. Hover adds only the neutral
fill; keyboard focus, opening, and editing restore the Border stroke as well. Invalid drafts use
Destructive borders. Read-only content
remains readable; disabled controls apply 50% once and do not react to hover. Search and multiline
fields retain their own boundaries. Workspace resize rails remain hidden at rest, Border on
hover, and Primary during dragging.

## Motion

| Kind              | Examples                                                                                   | Rule                                                   |
| ----------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| State feedback    | Hover, press, selection, validity: colour, fill, border, opacity, shadow                   | Instant. No transition                                 |
| Spatial change    | The Settings drawer sliding in, a menu appearing, a chevron turning, a switch thumb moving | Use the framework default duration for transitions     |
| Tooltip entry     | The shared tooltip appearing                                                               | `HoverTip` owns its entry delay and opacity transition |
| Data smoothing    | The Level Meter fill, the correlation marker gliding along its rail                        | Owned by the instrument; not a UI transition           |
| Looping indicator | The indeterminate update bar                                                               | Keyframes in `index.css`                               |

Reduced motion makes CSS transitions and animations effectively instant in `index.css` and
disables the indeterminate update animation. Entry delays remain. The Level Meter spring reads
the system preference separately.

`src/components/ui/motionContract.test.js` rejects `transition-colors`, `transition-all`,
`transition-shadow`, an opacity transition outside the tooltip, and any `duration-*` utility
outside the correlation marker.

## Borders, Tracks, and State

`--border` is an opaque colour; `--input` aliases the same resolved role. Consume them directly for
ordinary borders, dividers, control outlines, range tracks, and unchecked switches without local
alpha modifiers. Auto mixes Panel Surface 12% toward white in Dark or 10% toward black in Light.
Advanced Border Color supplies the final opaque colour. Grid is independent of Border.

Workspace panels have no permanent outer border or header underline. Surface colour, rounded
corners, and spacing define each panel. The resize hit regions retain their size, but their lines
appear only on hover or during dragging. Temporary location/drag rings remain. Header, Footer
(including their auto-revealed variants), and the File analysis summary also omit outer borders;
floating shell variants retain their Raised shadow.
Inputs retain their existing affordances; no new Input Border editor setting is introduced.

The unchecked switch track uses Input and the thumb stays opaque. See [Highlight States](#highlight-states)
for checked and hover colors. Inactive selectable marks are opaque hollow `muted-foreground`
circles; active marks are solid Primary. A no-data state hides only unavailable data markers and
does not dim the surrounding rail, axis, label, or control.

Status decoration is flat by default. Success, Warning, and Danger badges use an opaque neutral
surface with a solid semantic foreground. Notices use an opaque neutral fill plus a solid semantic
accent edge; invalid controls use a solid Danger border. Status colors do not create translucent
washes or glows.

The Source Transport is the deliberate emphasis exception. Live and Snapshot tint the opaque
Control Surface (`secondary`) with their Activity role at 10% for the shell, 24% for the action,
36% for action Hover, and 50% for the shell border. Text and icons use the full Activity color. The
action stays an edgeless oval, and every mix ends in `secondary`, never `transparent`; these four
strengths are centralized CSS recipes rather than Theme Editor roles.

## Color Tokens

### Shadcn Semantic

Values are compiled from the active Theme and are not recorded here. The current built-in output
for both schemes is the reviewed snapshot in `src/theme/__snapshots__/builtinThemesV2.test.js.snap`;
the authored inputs are in `src/theme/builtinThemesV2.js`.

| Token                      | Role                          |
| -------------------------- | ----------------------------- |
| `--background`             | Workspace background          |
| `--foreground`             | Primary text                  |
| `--card`                   | Panel surface                 |
| `--card-foreground`        | Text on panels                |
| `--popover`                | Raised surface                |
| `--popover-foreground`     | Popover text                  |
| `--primary`                | Interface accent              |
| `--primary-foreground`     | Text on primary buttons       |
| `--secondary`              | Control surface               |
| `--secondary-foreground`   | Text on secondary surface     |
| `--muted`                  | Muted surface                 |
| `--muted-foreground`       | Secondary / muted text        |
| `--border`                 | Borders and dividers          |
| `--input`                  | Shared control border         |
| `--ring`                   | Global keyboard focus outline |
| `--destructive`            | Error / danger state          |
| `--destructive-foreground` | Text on destructive           |

Do **not** create `--ui-*` aliases for any of the above — use the shadcn tokens directly.

### Component: Meter gradient

Paints the Level Meter's appearance-only Gradient option and its Theme Preview swatch. Gradient and
Level Zones both follow the module's Safe, Warning, and Critical colours. A selected Snapshot
remaps the Gradient tokens to the same lightly toned Palette History values that Level Zones use;
there is no meter-specific History family and no additional Theme Editor control.

| Token                        | Role                            |
| ---------------------------- | ------------------------------- |
| `--ui-meter-gradient-top`    | Active decorative Critical stop |
| `--ui-meter-gradient-mid`    | Active decorative Warning stop  |
| `--ui-meter-gradient-bottom` | Active decorative Safe stop     |

### Component: Instrument Traces

Instrument traces are compiled from the V2 Primary Data, Secondary Data, Status, and Frequency
authoring roles. Components consume only the resolved `--ui-*` tokens below (or the equivalent
Resolved Theme Canvas bundle); they never derive colors locally.

For Loudness history, `Momentary` and `Short-term` are equally important paired data series.
`Momentary` uses Primary Data and `Short-term` uses Secondary Data, with equal product-owned stroke
widths. The widths render in screen space rather than being visually compressed by SVG viewBox
scaling. Neither layer adds opacity or a dashed-line convention merely to distinguish the pair.

History colours are the data-state colours used only while a retained Snapshot is selected. Shared
History Primary and History Secondary roles give Core Data traces their clear state identity.
Status, Frequency, and Intensity use one common Palette History recipe that preserves hue and
chroma and moves only lightness slightly toward the panel. Interface-derived monochrome ink stays
unchanged. Selection remains a separate recipe and is not recoloured by History treatment.

Waveform lanes use a **stroke + fill** pattern: 1px strokes on both the max (top) and min (bottom)
envelope edges, plus a global semi-transparent fill opacity. The waveform publishes a Snapshot
state colour for its frozen time window, but does not overlay a second trace on top of the live
window.

The Loudness `Reference` layer is not drawn as a line or band. Instead, the reference LUFS drives an
**over-reference gradient** on the `M` and `ST` traces. The reference value is not shown as a
dedicated Y-axis tick.

Values come from the compiled Theme; see the built-in snapshot referenced under Shadcn Semantic.

| Token                             | Role                                    |
| --------------------------------- | --------------------------------------- |
| `--ui-loudness-momentary`         | Loudness M live primary data trace      |
| `--ui-loudness-momentary-snap`    | Loudness M snapshot trace               |
| `--ui-loudness-shortterm`         | Loudness ST live sibling data trace     |
| `--ui-loudness-shortterm-snap`    | Loudness ST snapshot sibling trace      |
| `--ui-loudness-selection`         | Selected-offset baseline                |
| `--ui-loudness-grid`              | Loudness grid lines                     |
| `--ui-vectorscope-trace`          | Vectorscope path (live)                 |
| `--ui-vectorscope-trace-snap`     | Vectorscope path (snap)                 |
| `--ui-vectorscope-guides-stroke`  | Vectorscope orientation guides          |
| `--ui-spectrum-primary`           | Spectrum primary path + fill            |
| `--ui-spectrum-primary-snap`      | Spectrum primary snapshot path + fill   |
| `--ui-spectrum-secondary`         | Spectrum secondary path + fill          |
| `--ui-spectrum-secondary-snap`    | Spectrum secondary snapshot path + fill |
| `--ui-waveform-trace`             | Waveform envelope stroke + fill         |
| `--ui-waveform-trace-snap`        | Waveform snapshot trace                 |
| `--ui-waveform-frequency-low`     | Low-frequency Waveform hue anchor       |
| `--ui-waveform-frequency-mid`     | Mid-frequency Waveform hue anchor       |
| `--ui-waveform-frequency-high`    | High-frequency Waveform hue anchor      |
| `--ui-waveform-frequency-neutral` | Broadband / unavailable spectral color  |
| `--ui-waveform-centroid`          | Spectral centroid overlay trace         |

Built-in neutral shell values are authored per color scheme rather than transformed at runtime.
Dark and Light share the same orange Accent and Primary Data, blue Secondary Data,
red/orange/blue Frequency, green/amber/red Status, Interface semantic colours, and canonical
Inferno Intensity stops. Their neutral shell and content colours remain scheme-specific.

The deterministic Semantic Gallery measures text and content contrast plus key data, snapshot,
Status, and Frequency distances in normal color, protanopia, deuteranopia, tritanopia, and
grayscale simulations. Targets and pass/fail results remain in its report as review evidence; they
do not gate a built-in Theme. These simulations are comparison aids; real renderer review and
redundant encoding remain part of approval.

### Component: Status, feedback, and activity

The Status Palette is measurement-only except for the transport Live indicator, which deliberately
reuses Status Critical. Each instrument consumes Status through module-local resolved roles, so a
local override cannot recolor another module. Interface feedback inherits the Interface Palette
directly. Transport Snapshot reuses the shared History Primary family.

| Binding family                                                   | Role                                                |
| ---------------------------------------------------------------- | --------------------------------------------------- |
| `--ui-level-{safe,warning,critical}`                             | Level Meter Level Zones and profile markers         |
| `--ui-stats-{warning,critical}-value`                            | Stats and Dock Stats profile values                 |
| `--ui-vectorscope-correlation-*`                                 | Vectorscope and Dock Vectorscope correlation marker |
| Stereo Map Canvas `safeRange` / `warningRange` / `criticalRange` | Stereo Map status-based modes                       |
| `--ui-waveform-{warning,critical}-range`                         | Loudness Profile breach portions                    |
| `--ui-feedback-{success,warning,danger}`                         | Application feedback on ordinary or tinted surfaces |
| `--ui-activity-{live,snapshot}`                                  | Live capture, recording, and snapshot activity      |

Feedback and activity tokens supply foreground colors. Visual Review reports insufficient
contrast while preserving the authored relationships (ADR 0021).

The retired `--ui-signal-good`, `--ui-signal-warn`, and `--ui-signal-bad` names exist only in the
frozen V1 migration path and must not be used by runtime consumers.

### Component: Spectrogram Colormap

The Theme's Intensity Palette provides ordered stops. `src/theme/spectrogramColormap.js` builds
the 256-entry LUT used by the Spectrogram renderers. Use it for area and density visuals. Line
traces use the resolved instrument colors above.

---

## Typography Tokens

Two font families:

```css
--ui-font-sans: "Inter", system-ui, sans-serif; /* Inter 4.1 is bundled */
--ui-font-mono: "JetBrains Mono", ui-monospace, monospace; /* JetBrains Mono 2.304 is bundled */
```

**Rule:** All live-changing numeric displays use `--ui-font-mono` + `tabular-nums`. Static UI text uses `--ui-font-sans`.

The application ships upright Inter weights 400–700 as one variable WOFF2 and JetBrains Mono
Regular/SemiBold as two static WOFF2 files. The system families are safety fallbacks only; local
font installation does not determine normal rendering.

### Normal-mode Text Roles and Sizes

Application surfaces, including Dock, use semantic typography roles instead of fixed Tailwind
font-size utilities or component-local pixel values. The sizes in this table are the **Small** profile baseline; the
Default profile is generally 1px larger (Metric Value is 2px larger). The complete profile matrix
appears below.

| Role                  | Token                  | Small baseline | Typical use                                                                                         |
| --------------------- | ---------------------- | -------------: | --------------------------------------------------------------------------------------------------- |
| **Caption**           | `--ui-fs-caption`      |           10px | Menu groups, compact metadata, drag/drop overlay labels                                             |
| **Axis Annotation**   | `--ui-fs-axis`         |           11px | Chart ticks, secondary hints, validation and tooltip text                                           |
| **Status**            | `--ui-fs-status`       |           11px | Header/footer state and compact status chips                                                        |
| **Control**           | `--ui-fs-control`      |           12px | Buttons, selects, inputs, management rows, and every settings surface including the Settings drawer |
| **Metric Annotation** | `--ui-fs-metric-meta`  |           12px | Metric names and units                                                                              |
| **Panel Title**       | `--ui-fs-panel-title`  |           12px | Panel, popover, editor and dialog titles                                                            |
| **Dynamic Display**   | `--ui-fs-display`      |           13px | Live chart values                                                                                   |
| **Body**              | `--ui-fs-body`         |           14px | General descriptions, empty states and standard UI controls                                         |
| **Metric Value**      | `--ui-fs-metric-value` |           16px | Primary metric values; mono with tabular numerals                                                   |

Relative `em` sizes are allowed inside a semantic parent when they express a local hierarchy.

## Icon Tokens

Normal application surfaces create icon tokens only for roles with an independent scaling policy.
Do not introduce a generic icon size scale.

| Role                  | Token                         | Small baseline | Usage                                                   |
| --------------------- | ----------------------------- | -------------: | ------------------------------------------------------- |
| Panel Action          | `--ui-icon-panel-action`      |           12px | Panel settings, help, pin, fullscreen and close actions |
| Management Action     | `--ui-icon-management-action` |           14px | Rename, delete, save, cancel and reset actions          |
| Shell Action          | `--ui-icon-shell-action`      |           14px | Icon-only actions in the normal application header      |
| Panel Module Identity | `--ui-icon-panel-module`      |           14px | Module identity next to a normal panel title            |

Icons paired with text use local `em` sizing instead of global tokens: inline indicators use `1em`,
button-leading icons use `1.15em`, and module-list icons use `1.25em`. Module definitions own only
the Lucide glyph; each rendering context owns its presentation size.

Status dots, switch thumbs, drag handles, resize rails, control containers and data visualizations
are component geometry, not iconography tokens. Dock is excluded and keeps its self-contained
responsive contract in `src/dock/dockTokens.css`.

## Interface Size Profiles

The global `settingsStore.interfaceSize` setting selects one of four profiles. The Small
baseline comes from [data.js](../src/preferences/data.js), with the other profiles defined in
[interfaceSize.js](../src/preferences/interfaceSize.js). The profiles set individual values for
text, icons, and geometry. See [Control Height](#control-height) for the row and control heights.

| Role                       | Small | Default | Large | Extra Large |
| -------------------------- | ----: | ------: | ----: | ----------: |
| Caption                    |  10px |    11px |  12px |        14px |
| Axis / Status              |  11px |    12px |  14px |        16px |
| Control / Panel Title      |  12px |    13px |  15px |        17px |
| Dynamic Display            |  13px |    14px |  16px |        18px |
| Body                       |  14px |    15px |  17px |        19px |
| Metric Value               |  16px |    18px |  21px |        24px |
| Panel Action Icon          |  12px |    13px |  15px |        17px |
| Management / Shell Icon    |  14px |    15px |  17px |        19px |
| Panel Module Identity Icon |  14px |    15px |  17px |        19px |
| Settings Drawer Width      | 320px |   336px | 368px |       400px |
| Theme/Profile Editor Width | 416px |   416px | 448px |       480px |

Every document applies the selected typography profile before first render. Dock header and
editor accessory documents retain compact Small geometry and icons to fit their native windows,
but receive the selected typography profile at startup and through accessory state publications.

---

## Spacing Tokens

Property vocabulary: `pad-x` / `pad-y` / `pad`, `gap`, `inset`, `min-h`, `w`.

Keep shared shell and panel padding, gaps, and insets on a 4 CSS px grid. These increments resolve
to whole device pixels at 100%, 125%, 150%, and 200% scale.

The same grid applies to the padding, margin and gap utilities written in components: `gap-1`,
`px-2` and `py-1`, never the half steps (`gap-0.5`, `px-1.5`) or a one-pixel gap. Items that sit
flush, such as the rows of a list or the icon actions of a header, use `gap-0` and carry their own
padding. `src/components/ui/spacingClassContract.test.js` guards these utilities. The Dock strip
uses its own [spacing tokens](#strip-geometry).

Form rows, the label-and-control rows of the Settings drawer and the panel settings, are one
`--ui-shell-h` tall and add no vertical padding of their own.

The space between two panels is the split resize rail, which takes `--ui-shell-gap`, so it always
equals the space around the panels. `src/preferences/spacingGridContract.test.js` rejects a spacing
value off the grid.

### Shell

```
--ui-shell-pad       0.25rem   Outer padding
--ui-shell-gap       0.25rem   Gap between shell regions and between panels
```

### Header

```
--ui-header-pad-x       0.5rem    Horizontal padding
--ui-header-pad-y       0.25rem   Vertical padding
--ui-header-action-gap  0.25rem   Gap between action buttons
```

### Footer

```
--ui-footer-pad-x    0.5rem    Horizontal padding
--ui-footer-pad-y    0.25rem   Vertical padding
```

The footer's minimum height is the header's height (`--ui-shell-h` plus twice `--ui-header-pad-y`),
so the two bars match although the footer holds only a line of status text.

### Panel

```
--ui-panel-pad-x              0.25rem   Horizontal padding inside each Card panel
--ui-panel-pad-y              0.25rem   Vertical padding inside each Card panel
--ui-splitter-bar-thickness   1px       Visual width of draggable splitter bar
```

#### Panel → Chart (sub-namespace)

```
--ui-chart-inset-top     0.25rem  Top inset within chart display area
--ui-chart-inset-bottom  0rem     Bottom inset within chart display area
--ui-chart-axis-gap      0.25rem  Gap between axis label column and chart area
--ui-chart-hud-inset     0.25rem  Inset for floating HUD / tooltip boxes
--ui-chart-x-axis-row-h      max(0.8rem, axis * 1.15)  Height of the x-axis label row
--ui-chart-y-axis-rail-w     max(20px, axis * 1.65)    Width of the y-axis label rail
```

#### Panel → Module Spacing

```
--ui-peak-channel-gap       0.25rem  Gap between peak meter channels
--ui-meter-chart-inset-x    0.5rem   Horizontal inset inside meter chart area
--ui-meter-label-top-inset  0.5rem   Top inset for meter channel labels
--ui-vector-outer-inset     0rem     Outer inset around vectorscope plot
```

#### Panel → Minimum Heights

```
--ui-min-h-peak           12rem    Peak panel minimum height
--ui-min-h-history        10rem    Loudness history panel minimum height
--ui-min-h-spectrum       10rem    Spectrum panel minimum height
--ui-min-h-history-chart  8rem     Loudness history chart area minimum height
```

### Metric Row

```
--ui-metric-row-pad-x    0.25rem   Horizontal padding inside each metric row
--ui-metric-row-gap      0.5rem    Gap between sibling metric rows
--ui-metric-row-min-h    1.25rem   Minimum row height
--ui-metric-list-gap     0rem      Gap managed by the scroll container
--ui-metric-inline-gap   0.5rem    Gap between inline label + value pairs
```

### Drawer (Settings Sheet)

```
--ui-drawer-pad          0.75rem   Inner padding of the settings drawer
--ui-drawer-gap          0.75rem   Gap between settings sections
--ui-drawer-row-gap      0.25rem   Gap between rows within a section
```

## Dock Tokens

### Strip geometry

[src/dock/dockTokens.css](../src/dock/dockTokens.css) scopes one set of values to the Dock strip at
every height.

| Token                        | Value | Use                     |
| ---------------------------- | ----: | ----------------------- |
| `--ui-dock-pad-x`            |   6px | Module horizontal inset |
| `--ui-dock-pad-y`            |   4px | Module vertical inset   |
| `--ui-dock-gap-column`       |   4px | Column spacing          |
| `--ui-dock-gap-row`          |   3px | Row spacing             |
| `--ui-dock-readout-w`        |   5ch | Numeric readout track   |
| `--ui-dock-toolbar-toggle-w` |  24px | Control rail width      |

The first-run height is 150 CSS px. The stored height has a 68 CSS px lower bound.
[dockMinHeight()](../src/dock/dockSizing.js) computes the strip's actual resize floor from three
Stats rows at the selected Interface Size, the shared row gaps, and vertical padding. The strip
also accounts for its horizontal scrollbar. Native display fitting sets the upper bound.
Keep the CSS padding and row gap in sync with the constants used for sizing.

### Typography roles

Use the normal panel's semantic typography in Dock. Interface Size selects the font sizes at
every strip height. Live chart readouts use Dynamic Display. Stats numbers use Metric Value,
and their labels use Metric Annotation. Live numbers use the shared mono family and tabular
numerals. The shared panels retain their local readout fit behavior where space is constrained.

### Vectorscope readable width

With axes visible, the correlation rail reserves five mono glyph advances for `-1`, `0`, and
`+1`, plus two 1em gaps. JetBrains Mono advances 0.6em per glyph, yielding a 5em floor at the
Axis Annotation size. With axes hidden, the floor fits three 4px reference dots and two
axis-font-sized gaps. Both calculations reserve 16 CSS px of horizontal clearance.
[Dock panel sizing](../src/dock/dockPanelSizing.js) applies the current floor while preserving
the saved preferred width.

### Shared panels and Stats

Dock wraps the shared [Level Meter](../src/dock/modules/DockLevel.jsx) and
[Loudness](../src/dock/modules/DockLoudness.jsx) with Dock sizing and panel controls. Level Meter
uses the shared orientation, PB Max, and value/TP Max marker controls. Loudness uses the shared
history chart, Layers, Ref, and axis controls. Use the shared panel for rendering changes that
apply to both surfaces.

[Dock Stats](../src/dock/modules/DockStats.jsx) fits columns to the measured width and lays out
selected metrics left to right, then top to bottom. Cell width reserves the measured labels and
five mono characters for each value. The grid recalculates when the width, labels, or fonts
change. Values omit units, and rows that exceed the available height remain accessible through
vertical scrolling.

---

## Dataviz Style Tokens

Stroke widths, fill opacities, and grid tuning for chart instruments.

### Loudness

```
--ui-loudness-momentary-stroke-width   1.2    Momentary trace stroke width
--ui-loudness-shortterm-stroke-width   1.2    Short-term trace stroke width
--ui-loudness-selection-stroke-width   1.2    Shared time-selection marker in Loudness, Waveform, and Spectrogram
```

### Vectorscope

```
--ui-vectorscope-stroke-width    1.2        Trace stroke width
--ui-vectorscope-grid-dash       "2.6 3.4"  Diagonal grid dash pattern
```

Polar Sample uses the Theme's Trace colour at full opacity for the newest samples, then applies the
panel's **Persistence** duration as a linear age fade to transparent. A Polar Sample Snapshot uses
the Theme's Snapshot colour at full opacity. Persistence is a display-only panel setting rather
than a Theme role because it controls time, not colour composition. Lissajous Hold Slow keeps its
fixed phosphor-style fade, and stroke width remains product-owned.

### Spectrum

```
--ui-spectrum-stroke-width           1.5    Trace stroke width
SPECTRUM_FILL_TOP                    0.20   Fixed upper fill-gradient opacity
SPECTRUM_FILL_BOTTOM                 0.02   Fixed lower fill-gradient opacity
```

The two fixed fill values from `src/lib/chartFill.js` are shared by Primary, Secondary, and Snapshot
Spectrum areas in Workspace, Dock, and Theme Preview. Stroke width remains product-owned.

### Stereo Map

```
STEREO_MAP_FILL_OPACITY           0.20   Fixed curve area fill opacity
--ui-stereo-map-stroke-width      1.5    Product-owned curve stroke width
```

`STEREO_MAP_FILL_OPACITY` from `src/lib/chartFill.js` is shared by all four modes, live and Snapshot
palettes, Dock, and Theme Preview. Position blends the module-local Primary
and Secondary data roles over the transition width selected by the panel's **Color Blend** setting;
Correlation and Mono Loss use the module-local Critical, Warning, and Safe ranges; M/S Ratio uses
Primary for Mid and Secondary for Side. The panel's independent **Energy Fade Strength** transforms
each measured per-band opacity while drawing. Neither display setting enters the analysis request
key. Stroke width remains product-owned and does not borrow Spectrum's token.

### Waveform

```
WAVEFORM_FILL_OPACITY           0.12   Fixed classic envelope fill opacity
--ui-waveform-stroke-width     1      Product-owned envelope stroke width
```

`WAVEFORM_FILL_OPACITY` from `src/lib/chartFill.js` is shared by Workspace, Dock, Live, Snapshot,
and Theme Preview, and applies only while **Frequency Color** is off. Frequency Color remains fully opaque because its palette is the waveform body rather
than an overlay; Spectral Centroid is unaffected.

---

## Radius Tokens

Three rungs, all derived from `--radius` (`0.625rem`), plus the pill.

| Utility        | Value  | Owner                                                           |
| -------------- | ------ | --------------------------------------------------------------- |
| `rounded-xs`   | `4px`  | Items nested in a `p-1` container; icon-only actions            |
| `rounded-md`   | `8px`  | Surfaces — panels, popovers, menus — and form controls          |
| `rounded-xl`   | `12px` | Floating windows: the draggable editors and the centred dialogs |
| `rounded-full` | pill   | Switches, sliders, resize rails, dots                           |

Two rules decide the rung, in this order:

1. **Concentric.** A child sitting on its parent's corner takes `parent − padding`. A menu row in a
   `p-1` popover is `8 − 4 = 4`, which is exactly `xs`. Break this and the two arcs stop being
   concentric, which reads as a seam nobody can name.
2. **Kind.** Otherwise a form control (button, input, select) takes `md` at the control height, the
   same value as the surface it sits on. An icon-only action has no box of its own until it is
   hovered or focused, so it takes `xs`, which keeps that small box from reading as a pill.

Use the shared radius utilities. `src/components/ui/radiusContract.test.js` guards against bare
`rounded`, unused intermediate rungs, and unapproved fixed radii. Keep `rounded-sm` and
`rounded-lg` defined in CSS so Tailwind's defaults do not replace them.
`src/preferences/uiTokenContract.test.js` checks for undefined `--ui-*` references.

---

## Text Casing Conventions

Put the intended casing in the source string. The Source Transport source chip is a specific
exception. It styles its Title Case source label as uppercase on screen.

| Casing                                  | Used for                                                                                                                                                                               | Examples                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **ALL CAPS**                            | Live state / transport chips only — read as indicator lights                                                                                                                           | The Source Transport's `LIVE` / `FILE` source and its `START` / `STOP` / `OPEN` action |
| **Title Case** (minor words lowercased) | Everything else informational: panel titles, metric names, meter captions, menu section headers, footer labels, settings rows + options, shortcut descriptions, tooltips, placeholders | `TP Max`, `Correlation`, `Open at Login`, `Save as Preset…`                            |
| **Sentence case**                       | Full sentences / messages: status text, empty states, error & help text, gesture hints                                                                                                 | `Up to date`, `No stats selected`, `Combo unavailable, try another`                    |
| **Canonical**                           | Acronyms & units keep their standard form                                                                                                                                              | LUFS, LU, dB, %, LRA, PSR, PLR, TP, L/R/C/LFE                                          |

Minor words (a, an, the, and, or, at, to, of, on, for, in, by, vs, via…) stay lowercase in Title
Case unless they are the first or last word. Follow the lowercase `aria-label` convention in
[`AGENTS.md`](../AGENTS.md#code-style) for screen-reader-only labels.
