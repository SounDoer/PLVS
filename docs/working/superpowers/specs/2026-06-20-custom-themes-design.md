# User Custom Themes — Design

Date: 2026-06-20
Status: Approved design (pending implementation plan)

## 1. Background & Goals

The theme-token refactor (`2026-06-19-theme-token-seed-refactor-design.md`) left PLVS with a clean
seed/derive model: a theme is `{ id, label, colorScheme, semantic (shell), seeds, colormap }`, and
`buildThemeTokens(theme)` derives every instrument color. This was deliberately built to support
**user-designed themes** — the deferred "phase 3".

This spec covers the **first user-theming slice (level "B")**: a user can duplicate a builtin theme
into a named **custom theme**, edit its **seed colors AND shell colors** in a floating editor with a
**live, full-app preview**, and select it like any builtin. The editor and data model reuse the
existing seed/derive pipeline with no special-casing in the render path.

**Out of scope (later slices, "C"):** editing the spectrogram colormap, importing community shadcn
presets (paste-CSS → shell) and the accent/primary collision rule, user-swappable colormap presets,
export/share of individual themes, and `system`-mode mapping to custom themes.

## 2. Scope

**In scope**
- A `CustomTheme` data model (full standalone snapshot, shaped like a builtin theme).
- A `themesStore` persistence domain for the custom-theme collection.
- A theme **registry/resolution** layer so a custom id resolves to its theme object; deleted/unknown
  ids fall back to `plvs-dark`.
- A floating, draggable **editor panel** (clamped in-window, remembers position) with live preview.
- Editing of **seeds** (5 colors) and **shell** (19 shadcn semantic values, alpha-capable).
- Draft / Save / Cancel semantics applied live via `applyThemeToDocument`.
- Create = **duplicate the currently active theme**; rename, delete, duplicate of custom themes.

**Out of scope** — see §1.

## 3. Decisions (locked during brainstorming)

1. **Data model = full standalone snapshot** (not override-on-base). A custom theme copies the base's
   shell/seeds/colormap/colorScheme at creation and is thereafter self-contained.
2. **Custom themes are only selectable under `appearance: "fixed"`.** `system` mode keeps following
   the OS between the two **builtin** themes; it never maps to a custom theme.
3. **Live preview = apply the draft to the whole real app** (`applyThemeToDocument(draft)`), not a
   contained preview component.
4. **Editor is a floating, draggable panel** (not a Settings sub-view). Opening it **hides** the
   Settings sheet; it is non-modal with no dimming overlay; clamped to the window; position is
   remembered.
5. **Invariant: editing always operates on the currently active theme.** Selecting a custom theme
   activates it; only the active theme can be edited. This makes the live preview unambiguous.
6. **Create = duplicate the active theme** (no separate "pick a base" step). `colorScheme` is
   inherited from the active theme. To start from Light, select Light first, then duplicate.
7. **Closing the editor returns to the app** (Settings does not auto-reopen).
8. **`colorScheme` is fixed at creation** (B does not let the user flip dark↔light for a custom theme).
9. **colormap is copied from the base and not editable in B.**

## 4. Data Model

```
CustomTheme = {
  id: "custom-<uuid>",            // distinct from builtin ids
  name: string,                   // user-facing label, shown in the picker
  colorScheme: "dark" | "light",  // inherited at creation, fixed in B
  seeds: {
    accent: string,
    accentSecondary: string,
    signal: { good: string, warn: string, bad: string },
  },
  semantic: { /* the 19 shadcn shell keys, same shape as PLVS_SEMANTIC_DARK */ },
  colormap: SpectrogramColorStops,  // copied from base; not edited in B
}
```

This is structurally identical to a `BuiltinTheme` minus `label` (uses `name`) — so it feeds
`buildThemeTokens`, the shell application, and the spectrogram colormap path with **zero render-path
special-casing**.

Color **values** may be any CSS color string (hex, `rgba(...)`, or `oklch(...)`). A freshly
duplicated theme carries the base's `oklch(...)` shell strings; once a field is edited it becomes the
color control's output (hex or `rgba`). Mixed formats within one theme are fine —
`applyShadcnSemanticTokensToDocument` + `oklchSafe` accept any CSS color, and `buildThemeTokens`
operates on the (hex) seeds.

## 5. Persistence & Resolution

### 5.1 Storage
- New domain store **`themesStore`** (`createDomainStore({ name: "plvs:themes", backend })`), sibling
  to `settingsStore`/`workspaceStore`/`presetsStore`. Holds `{ themes: { [id]: CustomTheme }, order:
  string[] }`.
- `settingsStore` is unchanged in shape: it still persists `appearance` + `themeId`; `themeId` may now
  be a `custom-…` id.
- `themesStore` is added to `exportAll()` and `resetAll()` in `src/persistence/index.js`.

### 5.2 Registry / resolution
The render path must resolve any id (builtin or custom) to a theme object. Introduce a small registry:
- `getTheme(id, customThemes) -> BuiltinTheme | CustomTheme` — builtin first, then custom; falls back
  to `BUILTIN_THEMES["plvs-dark"]` for unknown/deleted ids.
- `isKnownThemeId(id, customThemes) -> boolean` — true if a builtin or an existing custom.
- `resolveThemeId(shell, systemPrefersDark, customThemes)` — extend the existing resolver: under
  `fixed`, an existing custom id resolves to itself; an unknown/deleted id falls back to
  `DEFAULT_THEME_ID` (this is how "deleting the active custom theme returns to Dark" works).
- `applyThemeToDocument` takes/looks up the resolved theme **object** via `getTheme` instead of
  `getBuiltinTheme`, then runs the existing `buildThemeTokens` + shell + colormap writes unchanged.

Custom themes are loaded from `themesStore` and provided to these functions (via `useSettings`, which
already owns `appearance`/`themeId` and the resolved theme). First-paint (`theme:generate`) is
untouched — it emits `plvs-dark` only; a fixed custom theme is applied by JS after load, exactly like
a fixed builtin today.

## 6. Editor UX

### 6.1 Entry points (Settings → fixed theme picker)
- The picker lists builtins (Dark, Light) + custom themes.
- **Duplicate / New** (one primitive): duplicates the **currently active** theme into a new
  `CustomTheme` (`name` e.g. `"<base> copy"`), activates the copy, **hides the Settings sheet**, and
  opens the floating editor.
- A selected **custom** theme shows **Edit**, **Delete**, **Duplicate**. Builtins show only
  **Duplicate** (they are not editable).
- Deleting the active custom theme reverts selection to `plvs-dark`.

### 6.2 Floating editor panel
- Rendered outside the Settings sheet; **non-modal, no dimming overlay**.
- **Draggable by its title bar**, position **clamped within the window**; last position persisted in
  `settingsStore` (e.g. `themeEditorPos: {x,y}`).
- Contents:
  - **Name** input; `colorScheme` shown read-only.
  - **Seeds** group: `accent`, `accentSecondary`, `signal.good/warn/bad` (5 color controls).
  - **Shell** group: the 19 shadcn semantic values, sub-grouped (surface / text / border / brand…),
    scrollable.
  - Actions: **Save**, **Cancel**, and **Delete** (when editing an existing theme).
- Closing (Save or Cancel) returns to the app; Settings does not auto-reopen.

### 6.3 Color control
- One reusable control used for every field: a **swatch button** opening a popover with a picker, a
  hex input, and an **alpha slider** (needed because shell `--border`/`--input` are semi-transparent).
  No third-party color-picker dependency. Solid fields simply sit at alpha = 100%.
- The control emits a CSS color string (hex when alpha = 100%, else `rgba(...)`).

### 6.4 Draft / Save / Cancel semantics
1. Opening the editor snapshots the active theme into an in-memory **draft**.
2. Each edit updates the draft and immediately calls `applyThemeToDocument(draft)` — the real UI
   recolors live.
3. **Save** writes the draft to `themesStore` (overwriting that custom theme) and keeps it active.
4. **Cancel** discards the draft and re-applies the theme that was active **before** the editor
   opened. For a just-created (duplicated) theme, Cancel also **discards the new theme** entirely and
   reverts to the previously active theme.

## 7. Testing

- **`themesStore` CRUD:** create (duplicate), rename, delete, duplicate; persistence round-trip.
- **Registry/resolution:** `getTheme`/`isKnownThemeId` with a custom present; `resolveThemeId` returns
  an existing custom id under `fixed`, and falls back to `plvs-dark` for a deleted/unknown id
  (includes the "delete active custom theme → fallback" case).
- **Draft semantics (pure logic):** edit mutates draft; Cancel restores the pre-edit theme; create +
  Cancel discards the new theme. Assert which theme object would be applied in each case (inject the
  apply function so it is observable without a DOM).
- **Color control:** emits hex at alpha 100%, `rgba(...)` below 100%; round-trips an `oklch(...)`
  input value (displays it, leaves it unchanged until edited).
- **Clamp-in-window:** the panel-position clamp function keeps the panel within bounds (unit test the
  pure math; the drag interaction itself is not unit-tested).
- **Pass-through:** `buildThemeTokens(customTheme)` produces the same token set as for a builtin (no
  special-casing) — a custom theme with the dark seeds yields dark's derived tokens.
- **Migration:** existing persisted `themeId = <builtin>` still resolves; `themeId = custom-…` resolves
  when present.
- `npm run check` must pass.

## 8. Deferred / Future (slice "C")

- Editing the spectrogram colormap; user-swappable colormap presets (viridis/magma/…).
- Importing community shadcn presets (paste CSS → shell) and the accent/primary collision rule.
- Export/share of individual custom themes.
- `system`-mode mapping to custom themes (designate a custom "dark" and "light").
- Letting a custom theme flip `colorScheme`.

## 9. Open Items Folded Into the Plan

- Exact sub-grouping/labels of the 19 shell fields in the editor.
- The color-control popover's exact layout (picker + hex + alpha).
- Whether `themeEditorPos` lives in `settingsStore` or a tiny dedicated key.
