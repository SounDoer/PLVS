# Theme V2 — Implementation Plan

**Date:** 2026-08-19  
**Status:** Implemented; merge gate green, final native desktop visual acceptance pending
**Spec:** `docs/superpowers/specs/2026-08-19-theme-v2-design.md`  
**ADR:** `docs/adr/0005-theme-v2-compiler-and-runtime.md`  
**Inventory:** `docs/working/design/theme-v2-color-inventory.md`

## Objective

Deliver the approved role-based custom-theme system without maintaining two renderer contracts or
changing existing saved themes unexpectedly.

The implementation is complete when:

- Core Colors, Palettes, and Advanced authoring are available in the floating editor;
- all visible color consumers use one Resolved Theme contract;
- old custom themes migrate without unintended visual changes;
- live drafts never write to persistence;
- the diagnostic-theme pass finds no unclassified visible color;
- old seed-only runtime paths, dead tokens, and hardcoded bypasses are removed;
- `npm run check` passes.

## Delivery evidence

Theme V2 is implemented on `codex/theme-v2` through `98407abf`. The focused commit sequence covers
the authoring foundation, compiler and builtin documents, first-paint generation, V1 migration,
revisioned runtime, every Canvas family, the three editor pages, Undo/Redo, Picker actions, and the
final V1 runtime boundary.

The final merge gate passed on 2026-08-19:

- Prettier and ESLint passed;
- 247 frontend test files / 2654 tests passed;
- the production Vite build passed;
- Rust fmt, clippy, 392 passing unit tests (1 ignored), and the VAD integration test passed.

A standalone-browser visual pass verified the Fixed Theme picker, all three editor pages, live CSS
revision publication, Interface Accent / Primary Data independence, Undo, and Cancel restoration.
Windows automation could read the real Tauri accessibility tree but could not activate or capture
the WebView2 surface; therefore Picker popover icon gestures plus Glass, tray, Dock, and accessory
window recoloring remain explicit native desktop acceptance items rather than claimed evidence.

## Delivery rules

1. Every phase lands as one or more focused commits with its own passing tests.
2. New compiler/runtime code is introduced behind pure seams before consumer cutover.
3. V1 may exist only at the versioned authoring ingress and frozen migrator after runtime cutover.
4. No component branches on theme version.
5. No manual edit is made under `src/generated`; `npm run theme:generate` or prebuild owns output.
6. Existing custom themes and builtins remain usable at every commit boundary.
7. Runtime diagnostic role IDs may change before V2 persistence is enabled; after V2 documents are
   written, stable IDs require migration rather than silent renaming.
8. This work does not touch audio capture, DSP, or engine code.

## Phase 0 — Preparatory correctness fixes

**Status:** Complete in `e2733ed9`

### Delivered

- destructive Button and Badge content use `--destructive-foreground` rather than hardcoded white;
- Vectorscope Polar Snapshot uses the snapshot trace token, matching Lissajous;
- regression tests cover both contracts.

### Exit evidence

- focused theme/Vectorscope tests pass;
- 237 frontend test files / 2570 tests pass;
- formatting, ESLint, and production build pass.

## Phase 1 — Authoring schema, presets, and role registry

This phase adds unused pure foundations. It does not change the active theme.

### Files

Create or establish final equivalents of:

```text
src/theme/themeSchema.js
src/theme/themeSchema.test.js
src/theme/themeRoleRegistry.js
src/theme/themeRoleRegistry.test.js
src/theme/palettePresets.js
src/theme/palettePresets.test.js
src/theme/themeColorMath.js
src/theme/themeColorMath.test.js
```

### Tasks

1. Define V2 authoring types and normalizers:
   - version, ID, name, and internal `colorScheme`;
   - six opaque Core Colors;
   - Status, Intensity, and Frequency palettes;
   - sparse color/reference overrides.
2. Normalize accepted author input to canonical opaque Hex while accepting supported pasted Hex,
   RGB, and OKLCH syntax.
3. Reject alpha for Core and palette anchors. Keep effect opacity out of authoring identity values.
4. Define immutable palette presets with stable kind-scoped IDs and full snapshot application.
5. Encode the Inventory's provisional role families in the Role Registry:
   - interface surfaces, text, content, borders, focus, and critical;
   - shared primary/secondary/companion/snapshot/selection/grid roles;
   - meaningful Loudness, Spectrum, Spectrogram, Vectorscope, Stereo Map, and Waveform leaves;
   - internal effects and publication bindings.
6. Validate unique IDs, dependency existence, compatible references, known recipes, binding shape,
   and acyclic dependencies.
7. Keep editor grouping metadata separate from dependency order so the future UI remains curated.

### Tests

- valid minimum and complete V2 documents normalize deterministically;
- invalid colors, alpha identity colors, missing roles, bad palette stops, and bad names reject;
- Intensity endpoints and ordering normalize correctly;
- preset application copies values rather than retaining live inheritance;
- registry duplicate/missing/cycle/type failures are explicit;
- every Core and Palette role has at least one downstream registered consumer;
- every user-facing Advanced role has label, description, section, and allowed mode metadata.

### Exit condition

Pure schema, palette, math, and registry tests pass; no production consumer imports the new compiler
yet.

## Phase 2 — Pure compiler and builtin golden baselines

### Files

Create or update:

```text
src/theme/compileTheme.js
src/theme/compileTheme.test.js
src/theme/builtinThemes.js
src/theme/builtinThemes.test.js
src/theme/legacy/resolveV1Theme.js
src/theme/fixtures/v1BuiltinResolved.js
scripts/generate-theme-fallbacks.mjs
```

The fixture location may change, but it must not be placed under `src/generated`.

### Tasks

1. Freeze the current correct V1 Dark/Light resolved outputs in a test fixture, including the Phase
   0 fixes.
2. Implement deterministic dependency-order compilation:
   - resolve Core and Palette values;
   - apply compatible references;
   - apply perceptual recipes;
   - apply sparse leaf overrides;
   - produce complete role, CSS binding, Canvas bundle, effect, and native sections.
3. Compile opaque target-specific text leaves instead of delegating text alpha to components.
4. Keep effect source color and opacity separate in resolved output.
5. Re-express builtin Dark and Light as immutable V2 authoring documents.
6. Tune recipes until approved builtin golden output is equivalent to the current appearance. Exact
   matches are preferred; reviewed perceptual tolerances require an explicit test comment.
7. Make the first-paint generator consume compiled builtin Dark CSS bindings.

### Tests

- compiler is pure and returns no shared mutable references;
- identical input produces deeply identical output;
- every registered required leaf and binding resolves;
- reference and override precedence is deterministic;
- companion, snapshot, selection, text, surface, border, and effect recipes have focused fixtures;
- Status never derives from Interface Accent;
- Interface Accent and Primary Data are independent;
- builtin Dark/Light golden comparisons pass;
- generated first-paint CSS matches compiled Dark bindings.

### Exit condition

The compiler can resolve builtins and representative custom themes completely, while the shipped
runtime may still use V1.

## Phase 3 — V1 migration and persistence boundary

Build and test migration before switching production consumers.

### Files

Create or update:

```text
src/theme/migrations/migrateV1Theme.js
src/theme/migrations/migrateV1Theme.test.js
src/theme/migrations/v1Fixtures.js
src/theme/customTheme.js
src/theme/customThemesRepo.js
src/theme/customThemesRepo.test.js
src/persistence/index.js
```

### Tasks

1. Move the minimum frozen V1 resolution logic into the migration namespace. It must not import the
   V2 runtime.
2. Implement one ingress:

   ```text
   raw theme -> detect version -> migrate V1 if needed -> normalize V2
   ```

3. Map V1 intent:
   - background/surface/text into Core;
   - Accent into Interface Accent and Primary Data independently;
   - Accent Secondary into Secondary Data;
   - signal seeds into Status;
   - colormap into Intensity;
   - scheme-specific Waveform values into Frequency/associated overrides.
4. Compile the initial V2 result and diff it against frozen V1 resolved output by leaf role.
5. Add explicit overrides for every meaningful difference required to preserve appearance.
6. Normalize the complete `plvs:themes` domain, including collection order and malformed-entry
   behavior, at its domain boundary.
7. Ensure export returns normalized V2 data. Do not add a new localStorage key solely because the
   document has `version: 2`.
8. Decide writeback behavior explicitly in code comments/tests:
   - read migration may remain non-mutating;
   - the next explicit theme mutation persists normalized V2;
   - merely launching PLVS must not destroy the user's original raw value on migration failure.

### Fixture matrix

- builtin-derived Dark and Light customs;
- custom shell values for every old semantic field;
- divergent old semantic Primary/Ring values that were overwritten at runtime;
- alpha-bearing border/input/surface values;
- custom signal colors and colormap;
- invalid/missing fields and unknown versions;
- duplicate names with distinct IDs;
- collection order containing unknown or duplicate IDs.

### Exit condition

Every valid V1 fixture produces a valid V2 authoring document whose compiled output preserves the
reviewed V1 appearance. Invalid data follows an explicit recoverable fallback and never yields a
partially resolved theme.

## Phase 4 — Central runtime and CSS/native publication

Cut runtime ownership over before rebuilding the editor. The existing V1 editor may temporarily feed
V1 drafts through the single migration ingress, but every consumer after that ingress receives only
Resolved Theme.

### Files

Create or update final equivalents of:

```text
src/theme/ThemeRuntimeContext.jsx
src/theme/themeRuntime.js
src/theme/themeRuntime.test.js
src/preferences/applyDocumentTheme.js
src/hooks/useThemeSettings.js
src/hooks/useSettings.js
src/App.jsx
src/dock/accessoryProtocol.js
src/dock/useDockAccessoryBridge.js
src/dock/accessories/useAccessoryClient.js
src/hooks/useGlassEffect.js
src/hooks/useTray.js
```

### Tasks

1. Centralize selection/draft compilation and immutable resolved snapshots.
2. Assign a monotonically increasing content revision independently of theme ID.
3. Apply the resolved CSS binding map and root metadata (`data-theme`, revision, `color-scheme`).
4. Preserve Appearance behavior:
   - System follows builtin Dark/Light;
   - Fixed resolves builtin or custom IDs;
   - deleted/unknown custom IDs fall back to the matching builtin scheme where known.
5. Expose selectors/subscriptions for complete resolved theme and narrow role bundles.
6. Publish draft snapshots to Dock accessory WebViews with revision ordering and a ready handshake.
   Reuse the existing accessory protocol primitives where possible; do not create a second unrelated
   event framework.
7. Let Glass and tray subscribe only to `colorScheme` or scheme-selected asset identity.
8. Keep selection persistence separate from draft publication.
9. Add an explicit compatibility ingress for the old editor, with a deletion task in Phase 6.

### Tests

- same theme ID with changed draft values increments revision and reapplies CSS;
- irrelevant role changes do not notify narrow native subscribers;
- System toggles publish the correct builtin resolved snapshot;
- Fixed custom selection resolves through migration/normalization;
- publishing any resolved draft revision writes zero times; the old editor's temporary eager-create
  behavior is removed and covered when the V2 editor lands in Phase 6;
- Cancel republishes the exact previous resolved snapshot;
- accessory clients reject stale revisions and receive latest state after ready;
- custom light/dark metadata continues to control Glass and tray correctly.

### Exit condition

DOM, SVG, accessory, and native consumers receive one resolved revision. V1 remains only at the
authoring ingress; there is no V1 rendering branch.

## Phase 5 — Canvas and palette consumer migration

Migrate one renderer at a time, keeping each commit independently testable.

### Suggested order

1. Vectorscope persistence and Polar;
2. Waveform Workspace and Dock;
3. Stereo Map Workspace and Dock;
4. Spectrogram 2D Workspace and Dock;
5. Spectrogram 3D colorized and monochrome.

### Primary files

```text
src/components/panels/VectorscopePanel.jsx
src/components/panels/VectorscopePolarPlot.jsx
src/components/panels/WaveformPanel.jsx
src/dock/modules/DockWaveform.jsx
src/components/panels/StereoMapPlot.jsx
src/components/panels/SpectrogramPanel.jsx
src/dock/modules/DockSpectrogram.jsx
src/hooks/useSpectrogramCanvas.js
src/hooks/useSpectrogram3dCanvas.js
```

### Tasks

1. Replace computed-style color parsing with resolved role bundles passed through existing panel/data
   boundaries.
2. Keep typography/layout CSS reads only where they are genuinely non-theme geometry.
3. Key redraw/caches by relevant role values or narrow revisions:
   - Workspace-only color edits do not redraw data canvases;
   - Primary Data edits redraw primary consumers but do not rebuild Spectrogram LUTs;
   - Intensity edits rebuild LUTs and redraw Spectrogram only;
   - Frequency edits recolor retained Waveform history without new audio frames.
4. Remove renderer-local color parsers and fallback palettes after the resolved contract covers them.
5. Centralize the one explicit Safety Fallback bundle for incomplete boot/test environments.

### Tests per renderer

- every consumed role changes visible paint under a stable theme ID;
- unrelated resolved roles do not cause redraw/rebuild;
- snapshot/live and primary/secondary identities remain correct;
- retained history recolors immediately;
- all Canvas output accepts normalized compiler color forms without CSS parsing;
- Dock and Workspace use the same semantic bundle;
- classic/non-colorized modes remain visually compatible.

### Exit condition

No production Canvas renderer calls `getComputedStyle` for color data or looks up a theme by ID.
Layout/typography CSS reads may remain documented.

## Phase 6 — Theme Picker and Editor V2

Replace the V1 editor and remove its compatibility ingress in the same phase.

### Primary files

Create or update final equivalents of:

```text
src/components/ThemePicker.jsx
src/components/ThemeEditor.jsx
src/components/theme-editor/CorePage.jsx
src/components/theme-editor/PalettesPage.jsx
src/components/theme-editor/AdvancedPage.jsx
src/components/theme-editor/ColorControl.jsx
src/components/theme-editor/IntensityPaletteEditor.jsx
src/hooks/useThemeEditor.js
src/hooks/useCustomThemeSettings.js
src/theme/customTheme.js
src/theme/customThemesRepo.js
src/components/SettingsPanel.jsx
```

Reuse existing `IconButton`, `AddButton`, `InlineConfirm`, Lucide Pencil/Copy/Trash icons, tooltips,
focus behavior, drag clamp, and Title Case conventions.

### Draft controller first

1. Replace eager creation with a true in-memory V2 draft.
2. Model edit history as committed author actions:
   - field commit is one action;
   - continuous picker/palette drag is one action;
   - Undo/Redo never writes Store.
3. Implement create/customize/duplicate through one `createThemeDraftFrom(base)` primitive.
4. Capture the complete prior selection, including System, for Cancel.
5. Validate names and structural color/palette/reference data before Save.
6. Save persists once; Cancel discards without cleanup writes.
7. Delete active custom falls back by stored `colorScheme`.

### Picker

1. Replace the plain theme select with Built-in and Custom sections.
2. Show selection state and a compact resolved swatch strip per row.
3. Builtins expose Customize; customs expose Edit, Duplicate, and Delete.
4. Inline icon actions have tooltips/`aria-label`s and do not select the row.
5. Use inline confirmation for Delete.

### Editor shell

1. Preserve floating, draggable, non-modal, clamped live preview.
2. Header contains name, Undo, and Redo; footer contains Cancel and Save.
3. Core page exposes exactly the six approved colors with “Used by” descriptions.
4. Palettes page exposes:
   - Status swatches;
   - editable Intensity stops and preset reset;
   - fixed Low/Mid/High Frequency anchors and presets.
5. Advanced uses the curated module-first grouping from the registry metadata.
6. Text/Surface leaves expose Auto/Custom. Compatible data leaves may expose Follow Primary,
   Follow Secondary, and Custom.
7. Reset to Auto deletes the override; it does not store a copy of the automatic value.
8. Do not add Theme Health, contrast warnings, safe editor colors, a fake general preview, or Core
   alpha.

### Color control

- visual field and hue control;
- Hex display with RGB/OKLCH paste acceptance;
- valid partial-edit commit behavior;
- no Core/Palette alpha;
- recent colors remain session-local;
- animation-frame-coalesced preview;
- gesture-level Undo grouping.

### Tests

- all CRUD and generated-name cases;
- Built-in immutability and inline action event isolation;
- System create/Save/Cancel behavior;
- no Store entry before Save for a new draft;
- exactly one persistence mutation on Save;
- Undo/Redo and picker gesture grouping;
- Core independence, palette editing, preset reset, and sparse overrides;
- structural Save blocking without aesthetic blocking;
- draggable/clamped/responsive editor behavior;
- accessible names, focus, tooltip, keyboard, and confirmation flows.

### Exit condition

The V2 editor is the only custom-theme authoring UI, every saved mutation writes V2, and the old
editor compatibility ingress is deleted.

## Phase 7 — Diagnostic theme, cleanup, and documentation

### Diagnostic pass

1. Add a development/test-only fluorescent theme fixture whose Core and Palette families are
   intentionally unrelated.
2. Traverse every state listed in the Color Inventory, including all visualization modes, snapshots,
   selections, holds, Dock density modes, accessory windows, Glass, and tray scheme changes.
3. Record screenshots or deterministic visual assertions where practical.
4. Classify every leak before changing it: registered role, Internal Effect, Safety Fallback, Asset,
   or dead code.

### Cleanup

- remove old `buildThemeTokens()` runtime and seed-only theme shape;
- remove direct theme lookups from components and Canvas;
- remove dead `--chart-1` through `--chart-5` if still unused;
- remove unused Badge status variants or route any new consumers through Status Palette;
- remove the unused sample-peak token/helper if runtime traversal confirms no visible marker;
- replace black/white scrims, sheen, and shadow literals with registered effects;
- split overloaded muted text/annotation/disabled consumers onto their resolved leaf bindings;
- retain only explicit centralized Safety Fallback and Asset allowlists;
- add a static contract test that rejects new unregistered production color literals.

### Documentation

- update `docs/architecture.md` with Authoring → Compiler → Resolved → Runtime flow;
- update `docs/design-tokens.md` to document CSS bindings as output rather than authoring schema;
- update the Color Inventory status and final role list;
- keep ADR 0001/0002 unchanged as history; ADR 0005 records supersession;
- move or delete obsolete working V1 theme plans only according to repository documentation policy.

### Exit condition

The diagnostic pass is clean, the hardcoded-color scan has only reviewed allowlists, obsolete runtime
paths are gone, standard docs describe delivered code, and `npm run check` passes.

## Verification matrix

| Contract                    | Automated evidence             | Manual evidence                                   |
| --------------------------- | ------------------------------ | ------------------------------------------------- |
| Core simplicity             | schema/editor tests            | Build a coherent theme using Core only            |
| Interface/Data independence | compiler + consumer tests      | Change each while observing buttons and charts    |
| Palette semantics           | compiler/LUT/mapping tests     | Status, Spectrogram, and spectral Waveform review |
| Advanced completeness       | registry binding tests         | Module-by-module override review                  |
| Live preview                | runtime/editor tests           | Drag colors across main/Dock/accessory windows    |
| Persistence                 | repo/editor/migration fixtures | Restart with old and new custom themes            |
| Cancel/Undo                 | controller tests               | System and Fixed manual flows                     |
| Canvas invalidation         | redraw/LUT counter tests       | Retained-history recolor review                   |
| Native scheme               | Glass/tray tests               | Light/dark custom theme desktop check             |
| No leaks                    | static literal contract        | Fluorescent diagnostic traversal                  |

## Commit sequence

Recommended commit boundaries:

1. `feat(theme): add V2 authoring schema and role registry`
2. `feat(theme): compile resolved themes from role intent`
3. `feat(theme): express builtin themes through V2 compiler`
4. `feat(theme): migrate persisted V1 custom themes`
5. `refactor(theme): publish resolved theme revisions`
6. one commit per Canvas family, or grouped only where a shared seam requires it;
7. `feat(theme): add V2 draft controller and picker`
8. `feat(theme): add Core and Palette editor pages`
9. `feat(theme): add Advanced role overrides`
10. `refactor(theme): remove V1 runtime and color bypasses`
11. `docs(theme): document Theme V2 architecture and tokens`

Do not combine migration, runtime cutover, all Canvas conversions, and editor replacement into one
commit; that would make appearance regressions difficult to bisect.

## Merge gate

Before merge:

1. run all focused suites throughout each phase;
2. run `npm run check` after final cleanup;
3. run the desktop diagnostic-theme traversal for WebView, Glass, and tray behavior;
4. confirm old V1 fixtures and real persisted themes migrate visually;
5. confirm no generated file was edited manually;
6. verify the branch contains no temporary debug instrumentation or unclassified hardcoded color.

No capture smoke or soak is required unless implementation unexpectedly touches
`src-tauri/src/audio`, `dsp`, or `engine`.
