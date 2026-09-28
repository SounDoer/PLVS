# Non-Data Visual Opacity Implementation Plan

**Goal:** Implement the approved non-data opacity design so Workspace and Dock share a small,
semantic visual language without changing measurement-data rendering.

**Spec:** `docs/history/specs/2026-09-28-non-data-visual-opacity-design.md`

**Architecture:** Theme continues to own color identity. Shared UI primitives own neutral Hover,
compact controls, chart guides, structural surfaces and elevation. Components consume those
primitives instead of composing local alpha values. Structural Surface Opacity remains the sole
user-controlled UI transparency; Flat/Raised/Modal replaces the shadow-size ladder at product call
sites.

**Tech stack:** React 19, Tailwind CSS 4, Vitest with jsdom, Tauri desktop visual verification.

## Ground rules

- Work on `main`; do not create a branch or worktree without asking.
- Do not edit `src/generated/` or `docs/agent-control/generated/` by hand.
- Preserve chart-data opacity and Canvas/SVG measurement composition outside the spec's explicit
  interaction-guide changes.
- Use shared semantic styles; do not replace one scattered number with another scattered number.
- Add or update tests before each implementation slice where a stable class/DOM contract exists.
- Run focused Vitest files during each task and `npm run check` after all tasks.
- Visual verification must use the real Tauri app. Vite alone cannot verify native window
  transparency or Dock surfaces.

## File map

| Area | Primary files |
| --- | --- |
| Global visual tokens | `src/index.css`, `src/components/ui/surfaceStyles.js`, new focused shared-style modules as needed |
| Shell and structural surfaces | `src/lib/shellLayout.js`, `src/workspace/LeafView.jsx`, `src/workspace/SplitLayout.jsx`, `src/components/FileAnalysisSummary.jsx`, `src/dock/DockStrip.jsx` |
| Interaction and drag | `src/components/panels/AxisRail.jsx`, `src/workspace/DragContext.jsx`, Workspace/Dock resize handles and management rows |
| Chart guides | panel files under `src/components/panels/`, `TimelineLatestEdgeHint.jsx`, `TimelineSelectionEdgeHint.jsx`, new `ChartCrosshair.jsx` |
| Controls and state | `src/components/ui/{button,select,switch,label}.jsx`, compact Switch consumers, selection-list consumers |
| Dock measurement UI | `src/dock/modules/DockLevel.jsx`, `src/dock/modules/DockVectorscope.jsx`, `src/components/panels/VectorscopePanel.jsx` |
| Overlays | `HoverTip.jsx`, `SettingsPanel.jsx`, dialogs/editors, `PanelSettingsContent.jsx`, Dock accessory/HUD files |
| Status UI | `StatusPill.jsx`, `SourceTransportCluster.jsx`, `TransportButton.jsx`, `ui/badge.jsx`, warning/error notices |
| Contracts | `themeColorContract.test.js`, `surfaceStyles.test.js`, `shellLayout.test.js`, focused component tests |
| Living docs | `docs/design-tokens.md`, possibly `docs/architecture.md` and `docs/user/system-settings.md` |

---

## Task 1: Establish shared semantic style contracts

**Files:**

- Modify: `src/index.css`
- Modify: `src/components/ui/surfaceStyles.js`
- Modify: `src/lib/shellLayout.js`
- Add focused shared modules only where one responsibility has at least two consumers, for example
  `src/components/ui/controlStyles.js` and `src/components/panels/chartInteractionStyles.js`
- Test: `src/components/ui/surfaceStyles.test.js`
- Test: `src/components/ui/themeColorContract.test.js`
- Test: `src/lib/shellLayout.test.js`

- [ ] Add failing contracts for opaque Popover/Modal surfaces, direct `border` consumption and the
  absence of local alpha in shared surface recipes.
- [ ] Define named structural Workspace, Panel and Dock surface styles around
  `--surface-opacity`; consumers must not repeat the mix formula.
- [ ] Define semantic elevation styles: Flat (none), Raised and Modal. Raised and Modal share the
  Theme Shadow Color and contain all shadow geometry/strength.
- [ ] Remove the product use of the Tailwind shadow-size ladder from shared styles. Do not remove a
  framework token until every call site migrates.
- [ ] Remove `--ui-surface-highlight`, `--ui-surface-highlight-soft`, the inset-highlight helpers
  and the unused resize glow helpers.
- [ ] Add opaque filled-control Hover recipes derived from opaque Theme colors; do not mix with
  `transparent`.
- [ ] Run:
  `npx vitest run src/components/ui/surfaceStyles.test.js src/components/ui/themeColorContract.test.js src/lib/shellLayout.test.js`

## Task 2: Unify pointer, resize and drag feedback

**Files:**

- Modify: `src/components/panels/AxisRail.jsx`
- Modify: `src/workspace/SplitLayout.jsx`
- Modify: `src/workspace/LeafView.jsx`
- Modify: `src/dock/DockHeightResizeHandle.jsx`
- Modify: `src/dock/DockPanelResizeHandle.jsx`
- Modify: management-row, toolbar and Dock editor consumers found by the opacity inventory
- Test: `src/components/panels/AxisRail.test.jsx`
- Test: `src/workspace/SplitLayout.test.js`
- Test: relevant Workspace and Dock editor/resize tests

- [ ] Add or update tests for the canonical `muted/50` neutral Hover.
- [ ] Make Workspace and Dock resize lines use `border` idle, `primary/70` Hover and full Primary
  active/focused. Preserve different geometry and hit targets.
- [ ] Represent equal-split snap with full Primary and no glow.
- [ ] Keep persistent header actions at 50%→100% and row-management actions at 0%→100%.
- [ ] Keep shared drag-target rings at `primary/60`; retain Workspace's directional `primary/5`
  zone only where it communicates the destination half.
- [ ] Remove the unused resize-glow code after all references are proven absent.
- [ ] Run the focused Workspace, Dock resize and management tests.

## Task 3: Centralize chart interaction guides

**Files:**

- Add: `src/components/panels/ChartCrosshair.jsx`
- Add: `src/components/panels/ChartCrosshair.test.jsx`
- Modify: `LoudnessHistoryChart.jsx`, `SpectrogramPanel.jsx`, `SpectrumPanel.jsx`,
  `StereoMapPanel.jsx`, `WaveformPanel.jsx`
- Modify: `TimelineLatestEdgeHint.jsx`, `TimelineSelectionEdgeHint.jsx`
- Test: the corresponding panel and edge-hint tests

- [ ] Write tests that define one dashed `muted-foreground/50` guide treatment and support
  vertical-only or vertical-plus-horizontal rendering.
- [ ] Replace the five copied crosshair class blocks with `ChartCrosshair`.
- [ ] Keep committed selection strokes full-opacity Theme Selection colors.
- [ ] Name the Latest Edge and off-screen Selection Edge strengths inside their shared components;
  do not publish Theme controls for them.
- [ ] Remove the Spectrum hover-marker glow while keeping its solid module color and contrasting
  border.
- [ ] Verify that 3D Spectrogram and Canvas data opacity are untouched.
- [ ] Run the new crosshair test plus all five panel test files and both edge-hint tests.

## Task 4: Normalize controls, tracks and state semantics

**Files:**

- Modify: `src/components/ui/switch.jsx`, `button.jsx`, `select.jsx`, `label.jsx`
- Modify: `SettingsPanel.jsx`, `PanelSettingsContent.jsx`, `CloseConfirmDialog.jsx`
- Modify: `src/dock/modules/DockLevel.jsx`, `DockVectorscope.jsx`
- Modify: `src/components/panels/VectorscopePanel.jsx`
- Modify: selection-list consumers in App Header, Presets, Loudness Profiles, File History and
  Source Transport
- Test: focused UI, panel and Dock tests

- [ ] Add a shared compact Switch style: unchecked `input`, checked Primary, opaque thumb.
- [ ] Remove the Dock Level empty-track background and update tests to assert only measured fill is
  painted.
- [ ] Make Workspace and Dock correlation rails consume `--ui-vectorscope-grid-stroke` without an
  extra alpha.
- [ ] Remove no-signal parent opacity; keep the rail/axis and omit only the marker.
- [ ] Normalize disabled controls to one 50% opacity at the control boundary. Avoid a second
  disabled alpha on child labels/icons.
- [ ] Replace faded inactive selection dots with solid Primary active markers and opaque hollow
  `muted-foreground` inactive markers.
- [ ] Preserve drag-source, Hover-only action and unavailable-resize visibility states.
- [ ] Run focused tests for Switch, Settings, Panel Settings, Vectorscope, Dock Vectorscope, Dock
  Level and the affected selection lists.

## Task 5: Make overlays opaque and structural surfaces explicit

**Files:**

- Modify: `src/components/ui/surfaceStyles.js`, `popover.jsx`, `sheet.jsx`
- Modify: `HoverTip.jsx`, `FileDropOverlay.jsx`, `SettingsPanel.jsx`, `PanelSettingsContent.jsx`
- Modify: dialog/editor files returned by the opacity inventory
- Modify: `src/dock/accessories/DockHeader.jsx`, `DockEditorApp.jsx`
- Modify: `src/dock/modules/DockHistoryInteraction.jsx`
- Modify: structural-surface consumers in Workspace, shell, summary, fullscreen and Dock
- Test: surface, popover, overlay, Settings, Dock accessory/HUD and structural-surface tests

- [ ] Extend surface tests so every readable Raised or Modal surface is opaque.
- [ ] Route File Drop through the shared black-60 scrim and keep its prompt card opaque.
- [ ] Replace `popover/35`, `background/35`, `muted/25` and similar inset fills with opaque
  `muted` or `secondary` according to the spec.
- [ ] Remove `/85`, `/90`, `/95` raised-surface fills and backdrop blur used to compensate for them.
- [ ] Migrate Workspace, Panel, Fullscreen, Summary and Dock structural fills to the shared Surface
  Opacity styles without changing their source semantic color.
- [ ] Assert Surface Opacity is applied once and not inherited by content; retain the existing Dock
  shell and shell-layout contracts.
- [ ] Run all affected overlay and surface tests.

## Task 6: Remove local text, icon and ordinary-border attenuation

**Files:**

- Modify: Settings, Panel Settings, App Header, shell Footer, Help, Select and Copyable Text files
  returned by the inventory
- Modify: ordinary divider/border consumers across Workspace, Dock and shared UI
- Test: `themeColorContract.test.js` and focused component tests

- [ ] Classify every remaining non-data text/icon `/N` occurrence as Primary, Secondary,
  Annotation, Disabled or an intentional visibility transition.
- [ ] Replace static local alpha with `foreground`, `muted-foreground` or
  `--ui-text-annotation`; do not add Subtle Text.
- [ ] Keep actionable icons Secondary and make them Primary on Hover.
- [ ] Replace text-dot separators with short `border` dividers or spacing.
- [ ] Replace ordinary `border-border/N`, `divide-border/N` and `border-input/N` with the direct
  Theme effect, or remove a divider that is structurally redundant.
- [ ] Leave approved interaction/state edges to their owning tasks.
- [ ] Add an inventory-style contract that rejects new ordinary Border/Input double attenuation in
  the audited UI paths while allowing an explicit, small list of interaction exceptions.
- [ ] Run the contract and affected component tests.

## Task 7: Apply Flat, Raised and Modal elevation

**Files:**

- Modify every production `shadow-*` consumer reported by `rg`, excluding contrast outlines and
  approved state effects
- Test shared elevation contracts and representative Flat/Raised/Modal components

- [ ] Add tests for representative Flat surfaces: Workspace panel, input/select, Switch thumb and
  chart HUD have no drop shadow.
- [ ] Add tests for representative Raised surfaces: HoverTip, Popover and drag preview share the
  Raised class.
- [ ] Add tests for representative Modal surfaces: Settings/editor/dialog share the Modal class.
- [ ] Migrate all call sites; remove `shadow-2xl` and all product choices among
  `xs/sm/md/lg/xl/2xl`.
- [ ] Remove now-unused shadow-size customization only after `rg` proves no product consumer
  remains. Keep contrast rings for the color picker and Recording Indicator.
- [ ] Confirm Dock structural surfaces stay Flat while Dock overlays use Raised/Modal as
  appropriate.
- [ ] Run the representative tests and the full UI test set affected by the migration.

## Task 8: Replace translucent status decoration with flat semantic status

**Files:**

- Modify: `StatusPill.jsx`, `SourceTransportCluster.jsx`, `TransportButton.jsx`, `ui/badge.jsx`
- Modify: warning/error banners and invalid-control styles found by the inventory
- Modify: shared Button variants for opaque Hover colors
- Test: status, transport, badge, button and editor tests

- [ ] Add tests that status containers have an opaque neutral surface and solid semantic
  icon/text, with no `transparent` status mix or colored glow.
- [ ] Use the normal opaque selected surface for active Source state while retaining the solid
  Live/Snapshot marker color.
- [ ] Convert Warning/Error notices to an opaque neutral surface with a solid semantic accent edge
  and icon.
- [ ] Convert invalid controls to a solid Danger border without a translucent ring.
- [ ] Keep genuinely destructive primary actions as opaque Danger surfaces with on-Danger text.
- [ ] Migrate filled button Hover states from `/80` or `/90` alpha to the shared opaque Hover
  recipes.
- [ ] Remove the Live glow; retain the solid dot and its reduced-motion-aware pulse.
- [ ] Run all affected status and control tests.

## Task 9: Documentation, inventory closure and visual verification

**Files:**

- Modify: `docs/design-tokens.md`
- Modify if needed after implementation: `docs/architecture.md`, `docs/user/system-settings.md`
- Verify only: all production UI source files

- [ ] Update the living design-token document with the final interaction, text, border, surface,
  status and elevation contracts. Do not link living docs back to this historical record.
- [ ] Update user-facing Appearance documentation only if the final UI changes require a durable
  behaviour statement beyond the existing Surface Opacity description.
- [ ] Run a final source inventory for `opacity`, alpha color modifiers, `color-mix(...transparent)`,
  RGBA and shadow classes. Classify every survivor as data rendering, structural Surface Opacity,
  scrim, approved interaction/transition, contrast outline or Theme effect.
- [ ] Run focused tests from Tasks 1–8.
- [ ] Run `npm run check`.
- [ ] Start the real app with `npm run desktop` and visually compare:
  - Built-in Dark and Light.
  - Surface Opacity 100% and one reduced value.
  - Normal Workspace, Focus View and fullscreen.
  - Dock strip and Dock Editor.
  - Hover/focus/drag/resize/snap interactions.
  - Crosshairs, selection edges and no-correlation state.
  - Settings, Panel Settings, Tooltip, menu, editor, dialog and File Drop overlay.
  - Live/Snapshot/Warning/Danger states.
- [ ] Confirm the result remains readable without Subtle Text. If not, stop and open a new design
  discussion rather than adding a token opportunistically.
- [ ] Record the tested themes, Surface Opacity values and any intentional surviving alpha
  exceptions in the implementation handoff.

