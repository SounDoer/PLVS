# Design Token Specification

PLVS UI token system — established from design review, May 2026.  
Implement via `src/preferences/data.js` + `src/preferences/applyDocumentTheme.js`.  
Color themes are format- and semantics-versioned authoring documents compiled through
`src/theme/compileTheme.js`.

---

## Architecture

Three layers. Components consume **Semantic** (shadcn) or **Component** tokens only — never raw palette values.

```
Authoring    Six Core Colors, purpose-specific Palettes, and sparse Advanced overrides.
             Builtins live in builtinThemesV2.js; custom documents use the same schema.

Resolved     themeRoleRegistry.js defines every meaningful visible role, its value kind, and its
             dependencies. themeRecipes.js owns executable typed recipe contracts. compileTheme.js
             produces one complete immutable CSS / Canvas / effect contract. Chart fill opacity
             is fixed product composition in src/lib/chartFill.js (ADR 0019).

Component    PLVS-specific --ui-* tokens with no shadcn equivalent.
             Theme values are written by themeRuntime; layout and product-tuning tokens by
             applyLayoutToDocument().
             Responsive Dock tokens are scoped by src/dock/dockTokens.css because they depend
             on the Dock window viewport height. Sub-namespaces include typography, spacing,
             radius, dataviz, and dock.
```

---

## Focus

PLVS draws one focus ring, and only while the user is navigating with Tab.

The browser's own outline is cleared by one rule in the `base` layer of `index.css`. Chromium
paints `outline: auto` in a fixed high-contrast color on any focusable element that defines no
focus style, and reveals it after any keydown, including a bare modifier. PLVS is driven by
shortcuts, so that heuristic showed a ring to pointer users who had only pressed Ctrl+K.

`src/lib/keyboardNavigation.js` replaces the heuristic with an explicit state: Tab sets
`data-keyboard-nav` on the document, and the next pointer press clears it. One unlayered rule in
`index.css` paints a 2px `--ring` outline on the focused element while that attribute is set.
Shortcuts, modifiers and pointer use never raise it.

The hover fill and text colour that buttons show on keyboard focus follow the same attribute. A
button that only received focus back — its popover was closed with Escape by a pointer user, or
closed by Agent Control with no input — stays at rest. `:focus-visible` on its own matches both
cases, and whether it does depends on whether the window has had system focus, which made the
state differ between otherwise identical screenshots.

Components must not add a `focus-visible:ring-*` or `focus-visible:outline-*` of their own; a
contract test in `src/components/ui/themeColorContract.test.js` fails if one appears. A control
does not need a focus style at all: the global ring covers every focusable element, including ones
whose hover treatment is too faint to mark focus.

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

Interface Size rewrites the whole `--ui-fs-*` scale (`control` goes 13 → 15 → 17), so anything sized
in `px` or `rem` stays put while the text inside it grows. A box that fits at Default clips at
Extra Large, and nothing warns you.

The rule: **if a box's job is to hold text, size it in units that scale with that text.**

| Situation                    | Use                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Column holding a known label | `w-[calc(<label>em + <padding>rem)]` — the em share covers the text and any icon, the rem share the padding and gaps |
| Numeric field                | `w-[7ch]` — `ch` follows the font                                                                                    |
| Column holding a short unit  | `w-[3.2em]`                                                                                                          |
| Chart axis rail              | `max(<px floor>, calc(var(--ui-fs-axis) * <ratio>))`, as `--ui-chart-y-axis-rail-w` already does                     |
| Floating editor panel        | `--ui-editor-w`, which the Interface Size profiles set alongside `--ui-drawer-w`                                     |

Heights follow the same rule through one token: every form control is `--ui-control-h` tall, which
the Interface Size profiles set alongside the type scale. See Control Height.

## Grid Lines

Every optional panel Grid and every always-visible Vectorscope guide resolves from `data.grid`.
The default recipe mixes the resolved Panel Surface 8% toward white in Dark or black in Light,
independently from interface Border. The
renderer paints that opaque result directly: there is no panel-specific opacity multiplier or
weaker subdivision colour.

A contract test in `src/components/ui/themeColorContract.test.js` rejects the two shapes that
brought it back: a reference to `--ui-spectrum-grid-opacity`, and a grid stroked from `--border`.

Optional Grid is available in Loudness (Y axis), Spectrum (X and Y axes), Stereo Map (a separate
choice for each mode), and the two 3D Spectrogram modes (one shared choice). It defaults off. The
Vectorscope's orientation geometry is classified as Guides and stays visible. Waveform has neither
a Grid nor a centre reference line; Stereo Map has no unconditional zero reference line. Dock
modules do not expose optional Grid.

A grid line is 1px. Below that a stroke lands on a fraction of a device pixel and the renderer
pays for it in alpha, which reads as a colour problem and is not one — the vectorscope's diagonals
spent a long time at `0.35`.

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

`--surface-opacity` is a product-composition input, not a Theme color. It is a percentage and
defaults to `100%`. Apply it once to the fill at a structural boundary—Workspace, normal shell,
panel, fullscreen, file-summary shell, or Dock shell—through `--ui-surface-workspace`,
`--ui-surface-panel`, or `--ui-surface-dock`.
Do not apply it to a parent with CSS `opacity`, multiply it by a local fixed alpha, or route borders,
controls, typography, focus/state marks, Canvas, or SVG measurement data through it. Raised
overlays and editors remain opaque so their content has a stable reading surface.

At `100%`, the authored semantic hierarchy is the deterministic visual baseline. Lower values
expose the native window compositor without weakening the foreground information layer.

## Modal Scrim

`SCRIM_CLASS` in `src/components/ui/surfaceStyles.js` is the only dim in the app: black at 60%,
carried by every modal and by the file-drop target. Callers add only their own layer (see Layers).
The Settings Sheet adds `backdrop-blur-sm` to that scrim as modal focus feedback; its readable
drawer remains opaque. Other scrim consumers do not inherit that blur.

The scrim is deliberately not a theme colour. Darkening is a direction, not a hue, and a value
derived from the theme reverses it: the retired `effect.scrim` role tinted the workspace, which on
a light theme produced a near-white veil that washed the background out instead of dimming it. If
this ever needs to follow the theme, the opacity is what varies.

## Control Height

Interactive elements come in three heights, 4px apart, and all three follow one token. Interface
Size sets `--ui-control-h`; `index.css` derives the rest from it.

| Token            | Small / Default | Large | Extra Large | Used by                                                                                                                                                                                 |
| ---------------- | --------------- | ----- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ui-control-h` | 24px            | 28px  | 32px        | Form controls: text buttons, the add control, text and number inputs, the shortcut key cap, all select variants, a panel's choice rows, and the rows and labels that align to a control |
| `--ui-shell-h`   | 28px            | 32px  | 36px        | Shell chrome and dropdown options: header icon buttons, Source Transport, the panel header bar, popover title bars, the options of an open select                                       |
| `--ui-row-h`     | 32px            | 36px  | 40px        | List rows: every row of a menu, picker or managed list, whether the row itself is the click target (`MenuRow`) or holds a `RowAction` beside a handle and trailing actions              |
| `--ui-switch-h`  | 16px            | 18px  | 22px        | Every switch; its width and thumb are derived from it. Two thirds of the control height, rounded to 2px                                                                                 |

No component sets a height of its own. A row does not get its height from text plus padding,
which is how six spellings of "a list row" had drifted between 31.5px and 40px.

The control height stays at least one and a half times the largest text a control holds. A fixed
box would be outgrown by the 17px text of the larger sizes, which is why nothing carries a "grow
to fit" exception.

Multi-line fields size to their content. `src/components/ui/controlHeightContract.test.js` rejects
a fixed height above 24px written in a class string, and checks that the shared primitives read
these tokens.

## Buttons

Buttons come from a primitive; a hand-written `<button>` is not a way to get a different look.

| Primitive    | Where                           | Use                                                                                                                                    |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`     | `components/ui/button.jsx`      | Text actions. One size, the control height, at the Control font size                                                                   |
| `IconButton` | `components/IconButton.jsx`     | Shell-level icon actions with a neutral hover fill and a tooltip                                                                       |
| `IconAction` | `components/ui/icon-action.jsx` | Icon actions inline in a row or header. Colour change only; panel header actions add a hover fill through `PANEL_HEADER_ACTION_BUTTON` |
| `LinkButton` | `components/ui/link-button.jsx` | Text that reads as a link: no box, Secondary text that turns Primary on hover                                                          |
| `MenuRow`    | `components/ui/row.jsx`         | A full-width row that is itself the click target: menu items, picker options, disclosure headers                                       |
| `RowAction`  | `components/ui/row.jsx`         | The main click target of a row whose container paints the hover and holds a handle or trailing actions                                 |
| `TabButton`  | `components/ui/tab-button.jsx`  | One tab in an underlined tab strip                                                                                                     |
| `DragHandle` | `components/ui/drag-handle.jsx` | The grip that starts a reorder or placement drag                                                                                       |
| `AddButton`  | `components/AddButton.jsx`      | The dashed "add a new item" slot                                                                                                       |

`Button` variants are Primary (`default`), `secondary`, `ghost`, `outline`, `destructive` and `link`.
A dialog's dismissing action is `ghost` and its confirming action is Primary or `destructive`.

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
scrim, layer, centring, Modal surface, `rounded-xl` and `p-3` padding. Widths come in three sizes:
`sm` 20rem, `md` 28rem (the default) and `lg` 34rem, each capped to the window; `custom` hands the
width to the caller for content-sized or sectioned dialogs. `DialogTitle` uses the Control size in
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

Motion is sorted by what it is for, and only two kinds animate.

| Kind              | Examples                                                                                              | Rule                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| State feedback    | Hover, press, selection, validity: colour, fill, border, opacity, shadow                              | Instant. No transition                                               |
| Spatial change    | The Settings drawer sliding in, a menu or tooltip appearing, a chevron turning, a switch thumb moving | Animates at the framework default (150ms). No per-component duration |
| Data smoothing    | The Level Meter fill, the correlation marker gliding along its rail                                   | Owned by the instrument; not a UI transition                         |
| Looping indicator | The indeterminate update bar                                                                          | Keyframes in `index.css`                                             |

A measurement tool answers a pointer at once; a colour that takes 150ms to arrive says nothing the
instant change does not. Spatial motion stays because it shows where a surface came from.

A system "reduce motion" preference switches every CSS transition and animation off through one
rule in `index.css`, so no component has to remember it. Hover-intent delays, such as the
tooltip's, are timing rather than motion and are kept. The Level Meter spring reads the same
preference itself.

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

Compact and standard switches share the same state language: Input when unchecked, Primary when
checked, and an opaque thumb. Inactive selectable marks are opaque hollow `muted-foreground`
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

| Token                      | Role                                                    |
| -------------------------- | ------------------------------------------------------- |
| `--background`             | Workspace background                                    |
| `--foreground`             | Primary text                                            |
| `--card`                   | Panel surface                                           |
| `--card-foreground`        | Text on panels                                          |
| `--popover`                | Raised surface                                          |
| `--popover-foreground`     | Popover text                                            |
| `--primary`                | Interface accent                                        |
| `--primary-foreground`     | Text on primary buttons                                 |
| `--secondary`              | Control surface                                         |
| `--secondary-foreground`   | Text on secondary surface                               |
| `--muted`                  | Muted surface                                           |
| `--muted-foreground`       | Secondary / muted text                                  |
| `--border`                 | Borders and dividers                                    |
| `--input`                  | Shared control border                                   |
| `--ring`                   | Legacy compatibility token; not painted                 |
| `--destructive`            | Error / danger state                                    |
| `--destructive-foreground` | Text on destructive                                     |
| `--radius`                 | Base border radius; see [Radius Tokens](#radius-tokens) |

Do **not** create `--ui-*` aliases for any of the above — use the shadcn tokens directly.

### Component: Meter (Theme Preview swatch)

Paints the three-stop gradient in the Theme Preview swatch only. The Level Meter's bars use
`--ui-level-safe`/`warning`/`critical` instead, anchored to levels rather than to a fixed gradient --
see `src/lib/levelMeterColors.js`.

| Token                        | Role                                            |
| ---------------------------- | ----------------------------------------------- |
| `--ui-meter-gradient-top`    | Clip zone; same role as `--ui-level-critical`   |
| `--ui-meter-gradient-mid`    | Warning zone; same role as `--ui-level-warning` |
| `--ui-meter-gradient-bottom` | Safe zone; same role as `--ui-level-safe`       |

### Component: Instrument Traces

Instrument traces are compiled from the V2 Primary Data, Secondary Data, Status, and Frequency
authoring roles. Components consume only the resolved `--ui-*` tokens below (or the equivalent
Resolved Theme Canvas bundle); they never derive colors locally.

For Loudness history, `Momentary` and `Short-term` are equally important paired data series.
`Momentary` uses Primary Data and `Short-term` uses Secondary Data, with equal product-owned stroke
widths. The widths render in screen space rather than being visually compressed by SVG viewBox
scaling. Neither layer adds opacity or a dashed-line convention merely to distinguish the pair.

Snapshot colors are state colors for selected historical data. Within a theme, loudness,
vectorscope, and spectrum snap tokens should belong to one snapshot family. Do not treat snapshot
colors as new data categories, hover colors, or warning colors.

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

### Community publication analysis

Community intake uses `assessPortableThemeCommunityPublication()` after strict portable-document
validation. A malformed, incompatible, or unresolvable Theme is invalid rather than a visual
finding. For a valid Theme, visual analysis retains the established WCAG 2.2 reference targets:

- SC 1.4.3 at 4.5:1 for the small text pairs the analyser covers, including Annotation Text;
- SC 1.4.11 at 3:1 for the essential data and snapshot graphics the analyser covers.

Contrast findings and PLVS-specific OKLab separation, surface hierarchy, and Intensity-stop
findings are all non-blocking visual review. The result is scoped as `visualReviewOnly`; it is not a
claim that PLVS or the Theme has complete WCAG conformance. Local save, built-in Theme review,
Community publication, portable copy, import, and file export retain intentional choices. Only
structural, compatibility, and resolution errors make a Theme invalid.

The first community-sharing release publishes a fixed static preview set generated by PLVS from
the immutable portable Theme: one Semantic Gallery overview, one full Workspace scene, and one
real-renderer Product Gallery scene for each public module. The preview request accepts only that
Theme document. It has no screenshot, image, thumbnail, URL, or additional-media input, so authors
cannot upload, replace, append, or choose published imagery. Every asset records the portable
content hash and the versioned PLVS preview contract; the Gallery manifest must continue to contain
every referenced scene. The outgoing bundle must contain that exact asset set; missing, additional,
non-PNG, or non-PLVS-sourced images fail validation. An interactive website preview is intentionally
outside the first-release publication contract and is not a launch gate. The desktop Theme Editor
preview remains a separate local authoring aid.

Community distribution has one canonical payload with two transports. `Copy Theme` writes the
portable Theme JSON to the clipboard; the secondary `Download .plvstheme` action serves those exact
same bytes. PLVS accepts that direct portable document through Paste or file Import, while file
Import continues to accept the existing multi-item Theme pack envelope. The download is therefore
a fallback and archival path, not a second public Theme format.

Community pages describe the artefact's one authored appearance as `Dark Theme` or `Light Theme`;
they never imply that one Theme supports both schemes. A paired design is published as two distinct
Theme artefacts and therefore has two identities. The primary compatibility copy is generated from
one central Format/Semantics-to-release mapping: `Requires PLVS <minimum> or later`, or a closed
`Works with PLVS <minimum>-<maximum>` range if later compatibility evidence requires one. Expanded
technical details show `Theme Format 1 · Semantics 4`. Public-page generation fails while the first
shipping release remains unassigned, preventing a guessed minimum version from reaching users.

### Component: Status, feedback, and activity

The Status Palette is measurement-only except for the transport Live indicator, which deliberately
reuses Status Critical. Each instrument consumes Status through module-local resolved roles, so a
local override cannot recolor another module. Interface feedback inherits the Interface Palette
directly. Transport Snapshot reuses the Primary Snapshot state family.

| Binding family                                                   | Role                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------- |
| `--ui-level-{safe,warning,critical}`                             | Level Meter Gradient, Level Zones and profile markers |
| `--ui-stats-{warning,critical}-value`                            | Stats and Dock Stats profile values                   |
| `--ui-vectorscope-correlation-*`                                 | Vectorscope and Dock Vectorscope correlation marker   |
| Stereo Map Canvas `safeRange` / `warningRange` / `criticalRange` | Stereo Map status-based modes                         |
| `--ui-waveform-{warning,critical}-range`                         | Loudness Profile breach portions                      |
| `--ui-feedback-{success,warning,danger}`                         | Application feedback on ordinary or tinted surfaces   |
| `--ui-activity-{live,snapshot}`                                  | Live capture, recording, and snapshot activity        |

Feedback and activity colours are foregrounds on the panel. Feedback publishes the Interface
Palette value unchanged; Live publishes Status Critical; Snapshot publishes Primary Snapshot.
Visual Review reports insufficient contrast without altering those authored relationships
(ADR 0021).

The retired `--ui-signal-good`, `--ui-signal-warn`, and `--ui-signal-bad` names exist only in the
frozen V1 migration path and must not be used by runtime consumers.

### Component: Spectrogram Colormap

The spectrogram uses a per-theme ordered stop list, not a CSS variable.
The V2 Intensity Palette owns the ordered stops, and
`src/theme/spectrogramColormap.js` builds the 256-entry LUT consumed by
`useSpectrogramCanvas()`. The colormap is reserved for area/density visuals; 1D traces keep using
the instrument tokens above.

---

## Typography Tokens

Two font families:

```css
--ui-font-sans: "Inter", system-ui, sans-serif; /* set by applyLayoutToDocument */
--ui-font-mono: "JetBrains Mono", ui-monospace, monospace; /* set statically in index.css */
```

**Rule:** All live-changing numeric displays use `--ui-font-mono` + `tabular-nums`. Static UI text uses `--ui-font-sans`.

### Normal-mode Text Roles and Sizes

Normal application surfaces use semantic typography roles instead of fixed Tailwind font-size
utilities or component-local pixel values. Dock is excluded and owns its responsive typography
under `src/dock/dockTokens.css`. The sizes in this table are the **Small** profile baseline; the
Default profile is generally 1px larger (Metric Value is 2px larger). The complete profile matrix
appears below.

| Role                  | Token                  | Small baseline | Typical use                                                                                         |
| --------------------- | ---------------------- | -------------: | --------------------------------------------------------------------------------------------------- |
| **Caption**           | `--ui-fs-caption`      | 10px | Menu groups, compact metadata, drag/drop overlay labels                                             |
| **Axis Annotation**   | `--ui-fs-axis`         | 11px | Chart ticks, secondary hints, validation and tooltip text                                           |
| **Status**            | `--ui-fs-status`       | 11px | Header/footer state and compact status chips                                                        |
| **Control**           | `--ui-fs-control`      | 12px | Buttons, selects, inputs, management rows, and every settings surface including the Settings drawer |
| **Metric Annotation** | `--ui-fs-metric-meta`  | 12px | Metric names and units                                                                              |
| **Panel Title**       | `--ui-fs-panel-title`  | 12px | Panel, popover, editor and dialog titles                                                            |
| **Dynamic Display**   | `--ui-fs-display`      | 13px | Live chart values                                                                                   |
| **Body**              | `--ui-fs-body`         | 14px | General descriptions, empty states and standard UI controls                                         |
| **Metric Value**      | `--ui-fs-metric-value` | 16px | Primary metric values; mono with tabular numerals                                                   |

Relative `em` sizes are allowed inside a semantic parent when they express a local hierarchy.

## Icon Tokens

Normal application surfaces create icon tokens only for roles with an independent scaling policy.
Do not introduce a generic icon size scale.

| Role                  | Token                         | Default | Usage                                                   |
| --------------------- | ----------------------------- | ------: | ------------------------------------------------------- |
| Panel Action          | `--ui-icon-panel-action`      |    12px | Panel settings, help, pin, fullscreen and close actions |
| Management Action     | `--ui-icon-management-action` |    14px | Rename, delete, save, cancel and reset actions          |
| Shell Action          | `--ui-icon-shell-action`      |    14px | Icon-only actions in the normal application header      |
| Panel Module Identity | `--ui-icon-panel-module`      |    14px | Module identity next to a normal panel title            |

Icons paired with text use local `em` sizing instead of global tokens: inline indicators use `1em`,
button-leading icons use `1.15em`, and module-list icons use `1.25em`. Module definitions own only
the Lucide glyph; each rendering context owns its presentation size.

Status dots, switch thumbs, drag handles, resize rails, control containers and data visualizations
are component geometry, not iconography tokens. Dock is excluded and keeps its self-contained
responsive contract in `src/dock/dockTokens.css`.

### Interface size profiles

The global `settingsStore.interfaceSize` setting selects one of four hand-tuned profiles. Profiles
write final integer pixel values rather than applying browser zoom or one uniform multiplier.

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
| Control Height             |  24px |    24px |  28px |        32px |
| Shell Height               |  28px |    28px |  32px |        36px |
| List Row Height            |  32px |    32px |  36px |        40px |
| Switch Height              |  16px |    16px |  18px |        22px |

The normal application document applies the selected profile before first render. Dock header and
editor accessory documents always apply the compact Small baseline, while the Dock strip continues to use only its
responsive `--ui-dock-*` typography.

---

## Spacing Tokens

Property vocabulary: `pad-x` / `pad-y` / `pad`, `gap`, `inset`, `min-h`, `w`.

Spacing sits on a 4px grid: every padding, gap and inset below is 0, 4, 8 or 12px (0, 0.25, 0.5 or
0.75rem). Those are the only steps that are a whole number of device pixels at every display scale
PLVS runs at, 100%, 125%, 150% and 200%. A value between them, such as the earlier 0.3, 0.35 and
0.4rem, is exact at one scale and a fraction at the others, where the browser rounds each gap on
its own and neighbouring gaps end up a pixel apart.

The same grid applies to the padding, margin and gap utilities written in components: `gap-1`,
`px-2` and `py-1`, never the half steps (`gap-0.5`, `px-1.5`) or a one-pixel gap. Items that sit
flush, such as the rows of a list or the icon actions of a header, use `gap-0` and carry their own
padding. `src/components/ui/spacingClassContract.test.js` enforces this everywhere except the Dock
strip, whose spacing is the responsive set under Dock Tokens.

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
--ui-vector-corner-inset    0.5rem   Corner label inset in vectorscope
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
--ui-drawer-w            20rem     Preferred Small-profile drawer width
--ui-drawer-gap          0.75rem   Gap between settings sections
--ui-drawer-row-gap      0.25rem   Gap between rows within a section
```

## Dock Tokens

Dock is a separate high-density instrument surface with a supported height of `56–160px` and a
default height of `56px` (the compact density tier). It shares the global font families, semantic colors, and instrument
colors, but it does not reuse normal-panel typography or spacing dimensions. Normal panels have
minimum heights measured in `rem`; applying those dimensions to Dock would either overflow or
waste its limited data area.

Dock typography is self-contained and does not inherit user-configurable text-size preferences.
Its font sizes respond only to the Dock height tiers below.

Responsive Dock component tokens are owned by `src/dock/dockTokens.css` and scoped to
`.dock-strip`. Height media queries update them directly while the native Dock window is being
resized, without waiting for React state or persisted geometry.

### Responsive density tiers

| Role / token           | Compact `56–63px` | Standard `64–119px` | Expanded `120–160px` |
| ---------------------- | ----------------: | ------------------: | -------------------: |
| `--ui-dock-fs-label`   |               8px |                 9px |                 10px |
| `--ui-dock-fs-caption` |               8px |                 9px |                 10px |
| `--ui-dock-fs-value`   |              11px |                13px |                 15px |
| `--ui-dock-pad-x`      |               5px |                 6px |                  8px |
| `--ui-dock-pad-y`      |               3px |                 4px |                  6px |
| `--ui-dock-gap-region` |               4px |                 5px |                  7px |
| `--ui-dock-gap-column` |               3px |                 4px |                  5px |
| `--ui-dock-gap-row`    |               2px |                 3px |                  5px |
| `--ui-dock-bar-min-h`  |               4px |                 5px |                  6px |
| `--ui-dock-readout-w`  |               5ch |                 5ch |                  5ch |

The tiers are intentionally discrete. Typography must remain stable while the user adjusts height;
the additional space at larger heights primarily benefits bars, plots, and row separation rather
than continuously magnifying every label.

Dock Stats keeps `2px` between each label and its fixed-width value and reserves at least `12px`
between metric groups. Each metric cell compresses from a comfortable `72px` to `60px`, with the
label absorbing that reduction before the responsive grid drops a column from view.

### Typography roles

Within one density tier, the same typography role has the same size in every Dock module. Modules
must use these shared tokens rather than hard-coded font sizes or module-specific emphasis sizes.

- `Label`: detector names, channel names, and compact metric names (`PK`, `RMS`, `M`, `ST`, `L`,
  `R`, `LFE`). Static labels use `--ui-font-sans`, medium weight, and muted foreground.
- `Caption`: compact source-rail annotations such as `PB Max` and `TP Max`. Captions use
  `--ui-font-sans`, medium weight, muted foreground, and the repository Title Case convention. The
  full source name remains available through settings, `title`, and accessible text.
- `Value`: all dynamic numeric displays, including per-channel values, global values such as TP Max
  and correlation, and transport timecode. Values use `--ui-font-mono`, `tabular-nums`, and semibold
  weight. Modules express emphasis through color, weight, position, or interaction rather than a
  larger font size.

Do not append detector names or readout sources after a number. A trailing `M Max` or `RMS Max`
looks like a unit or a different metric. Detector identity belongs on the leading side of the
instrument; a non-live source belongs in a caption aligned with the readout column. Live is the
normal state and needs no caption.

### Responsive rules

- Height selects the density tier. Width does not scale font sizes.
- Additional width belongs to bars, plots, waveforms, and spectra; gaps do not grow with container
  width. Do not use `vw`, `cqw`, or percentage-based spacing for Dock layout gaps.
- Multi-row metric grids may reserve the configured `ch` capacity in their visible mono value
  column when label stability is more important than intrinsic width. A single source rail such as
  `TP Max` or `PB Max` instead keeps its visible source-and-value group intrinsic and trailing
  aligned; an invisible sizing layer reserves the complete region without adding visible whitespace.
- Labels use intrinsic (`max-content`) columns rather than reserving a fixed `ch` width for every
  abbreviation. A module-level Labels setting may remove optional labels to free more data width.
- `--ui-dock-bar-min-h` is a floor, not a fixed bar height. Channel rows divide all available Dock
  height with `minmax(var(--ui-dock-bar-min-h), 1fr)`, and each bar stretches to fill its row.
- Component-specific structural changes, such as multi-bank layout for high channel counts, may use
  container queries. They must not redefine the shared type or spacing scale.

### Reference module grammar

Level Meter is the reference implementation for label/bar/readout modules. Its detector label is
centered against the meter region only. The meter and readout regions are sibling grids that share
the same channel-row count but do not share caption layout:

```text
detector | meter region (channel | minmax(0, 1fr) bar) | readout region
```

Examples:

```text
PK   L   ━━━━━━━━━━━━━   -3.1
     R   ━━━━━━━━━━━━    -4.0

RMS  L   ━━━━━━━━━━━━━   PB Max   -12.2
     R   ━━━━━━━━━━━━             -10.8
```

A non-live readout adds one single-line source rail between the meter and value regions. Use
`TP Max` for true-peak maximum and `PB Max` for playback maximum; do not wrap either label. The rail
is vertically centered across the complete channel grid and does not participate in its row sizing.
Values retain the same channel-row alignment in Live and non-live states. Toggling a source rail
must not change the detector label, channel labels, bar rows, or their available height. Scalar
modes omit the channel column but keep the same detector → data region → source rail → readout
ordering.

Other Dock modules map their content onto the same roles:

- Loudness and Stats: metric name → Label; numeric metric → Value.
- Correlation: primary coefficient → Value.
- Spectrum and Spectrogram: compact scale annotations → Caption.
- Transport: timecode → Value.
- Waveform: necessary lane or channel annotations → Label.

Dock Stats lays selected metrics out from left to right, then top to bottom, using at most three
rows. Its column count follows the available panel width. Metrics that exceed the current capacity
are hidden from the end of the user-defined order, so ordering also defines narrow-width visibility
priority. Stats values do not repeat units in the Dock matrix.

Dock Loudness is the compact form of the normal Loudness panel, not a separate metric selector. Its
history region fills the available height and retains the normal panel's Momentary, Short-term,
and Reference layers. Reference uses the same over-reference trace gradients; Dock does not add a
separate reference line. A content-sized readout rail follows the history region and shows M, ST, and
I as three aligned Label → Value rows. Its settings reuse the normal panel's Ref, Layers, and
Y range controls and vocabulary.

---

## Dataviz Style Tokens

Stroke widths, fill opacities, and grid tuning for chart instruments.

### Loudness

```
--ui-loudness-momentary-stroke-width   1.2    Momentary trace stroke width
--ui-loudness-shortterm-stroke-width   1.2    Short-term trace stroke width
--ui-loudness-selection-stroke-width   1.2    Selection line width in every panel, incl. the 3D scrub marker
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

Surfaces and standard controls deliberately share one value. Elevation is already carried by the
`background → card → popover → secondary` lightness ladder and by shadow; saying it a third time in
the corner radius is redundant. Radius only needs to answer two questions: am I on someone else's
corner, and am I a window.

`rounded` (bare) is banned: Tailwind compiles it to a literal `0.25rem` that ignores `--radius`, so
it silently opts out of the ladder — and it was the single most used radius in the app before this
was written down. `rounded-sm` and `rounded-lg` stay defined but unused; deleting the definitions
would hand those utilities back to Tailwind's defaults, which is worse than leaving them. Hardcoded
`rounded-[Npx]` is banned for the same reason. `src/components/ui/radiusContract.test.js` enforces
all of it.

A `var(--ui-*)` that nothing defines fails silently — the declaration is dropped and the property
falls back to its initial value, with no console warning and no test failure. `--ui-radius-modal`
sat undefined long enough to square off all three floating panels that asked for it, which is why
`src/preferences/uiTokenContract.test.js` fails on any dangling reference.

---

## Text Casing Conventions

Displayed UI text follows four casing rules (standardized 2026-06-13). Casing lives in the
source strings, **not** in CSS `text-transform` — avoid `uppercase`/`capitalize` utility classes,
which fight the source strings and don't change DOM `textContent`.

| Casing                                  | Used for                                                                                                                                                                               | Examples                                                                                  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **ALL CAPS**                            | Live state / transport chips only — read as indicator lights                                                                                                                           | The Source Transport's `LIVE` / `FILE` source and its `START` / `STOP` / `ANALYZE` action |
| **Title Case** (minor words lowercased) | Everything else informational: panel titles, metric names, meter captions, menu section headers, footer labels, settings rows + options, shortcut descriptions, tooltips, placeholders | `TP Max`, `Correlation`, `Open at Login`, `Save as Preset…`                               |
| **Sentence case**                       | Full sentences / messages: status text, empty states, error & help text, gesture hints                                                                                                 | `Up to date`, `No stats selected`, `Combo unavailable, try another`                       |
| **Canonical**                           | Acronyms & units keep their standard form                                                                                                                                              | LUFS, LU, dB, %, LRA, PSR, PLR, TP, L/R/C/LFE                                             |

Minor words (a, an, the, and, or, at, to, of, on, for, in, by, vs, via…) stay lowercase in Title
Case unless they are the first or last word. Screen-reader-only `aria-label`s are not "displayed
text" and are exempt.
