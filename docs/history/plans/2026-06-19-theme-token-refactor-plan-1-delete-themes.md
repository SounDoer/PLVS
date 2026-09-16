# Theme Token Refactor — Plan 1: Delete the Three Preset Themes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the `plvs-phosphor`, `plvs-tungsten`, and `plvs-abyss` builtin themes, leaving only `plvs-dark` and `plvs-light`, and confirm a persisted id pointing at a deleted theme falls back to `plvs-dark`.

**Architecture:** The deleted themes live in two source files (`builtinThemes.js`, `shadcnSemanticPreset.js`) and are asserted in two test files. The theme resolver (`resolveThemeId`) already maps any id outside `THEME_IDS` to `DEFAULT_THEME_ID`, so migration needs no new logic — only `THEME_IDS` shrinking, plus a regression test. `meterColorOverrides` / `meterColorBridge.js` stay in place this plan (still serving dark/light); their removal is Plan 3.

**Tech Stack:** JavaScript (ESM), Vitest. Run from repo root.

**Spec:** `docs/working/superpowers/specs/2026-06-19-theme-token-seed-refactor-design.md` §6.

**Roadmap:** This is Plan 1 of 5 (delete themes → seed model → rename+purge → spectrogram colormap → docs).

---

### Task 1: Update theme tests to the two-theme world + add migration regression test

This is a deletion, so the "failing test" is the test suite rewritten to the intended post-deletion
reality. It will fail first because the code still defines the three themes.

**Files:**
- Test: `src/theme/builtinThemes.test.js`
- Test: `src/preferences/themeResolve.test.js`

- [ ] **Step 1: Rewrite the presence test in `builtinThemes.test.js`**

Replace the existing `it("contains plvs-dark, plvs-light, plvs-phosphor, and plvs-tungsten", ...)`
block (lines 45–51) with:

```javascript
  it("contains exactly plvs-dark and plvs-light", () => {
    expect(THEME_IDS).toContain("plvs-dark");
    expect(THEME_IDS).toContain("plvs-light");
    expect(THEME_IDS).not.toContain("plvs-phosphor");
    expect(THEME_IDS).not.toContain("plvs-tungsten");
    expect(THEME_IDS).not.toContain("plvs-abyss");
    expect(THEME_IDS).toHaveLength(2);
  });
```

- [ ] **Step 2: Delete the per-theme tests for the removed themes in `builtinThemes.test.js`**

Delete these whole `it(...)` blocks (the abyss/phosphor/tungsten-specific ones, lines 113–171):
`"plvs-abyss has colorScheme dark"`, `"plvs-abyss meterColorOverrides sets coral as toggle label"`,
`"plvs-abyss meterColorOverrides uses cyan-tinted row backgrounds"`,
`"getBuiltinTheme returns plvs-abyss correctly"`, and the matching three `plvs-phosphor` and three
`plvs-tungsten` blocks. Leave the loop-based tests (`"defines distinct loudness history trace
tokens for every theme"`, `"defines one visually distinct chart snapshot family for every theme"`,
`"defines a distinct secondary spectrum color"`) untouched — they iterate `THEME_IDS` and will simply
run over the two remaining themes.

- [ ] **Step 3: Rewrite the `THEME_IDS` test and add a migration test in `themeResolve.test.js`**

Replace the `describe("THEME_IDS", ...)` block (lines 87–98) with:

```javascript
describe("THEME_IDS", () => {
  it("contains exactly plvs-dark and plvs-light", () => {
    expect(THEME_IDS).toContain("plvs-dark");
    expect(THEME_IDS).toContain("plvs-light");
    expect(THEME_IDS).not.toContain("plvs-phosphor");
    expect(THEME_IDS).not.toContain("plvs-tungsten");
    expect(THEME_IDS).not.toContain("plvs-abyss");
    expect(THEME_IDS).toHaveLength(2);
  });
});

describe("resolveThemeId migration for deleted themes", () => {
  it.each(["plvs-phosphor", "plvs-tungsten", "plvs-abyss"])(
    "falls back to plvs-dark for removed fixed theme %s",
    (removedId) => {
      expect(resolveThemeId({ appearance: "fixed", themeId: removedId }, false)).toBe(
        DEFAULT_THEME_ID
      );
    }
  );
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/theme/builtinThemes.test.js src/preferences/themeResolve.test.js`
Expected: FAIL — `THEME_IDS` still has length 5 and still contains the removed ids; the deleted
per-theme blocks no longer exist so those don't error, but the presence/length and `not.toContain`
assertions fail.

- [ ] **Step 5: Commit the tests**

```bash
git add src/theme/builtinThemes.test.js src/preferences/themeResolve.test.js
git commit -m "test(theme): expect two-theme world and deleted-theme migration"
```

---

### Task 2: Remove the three themes from `builtinThemes.js`

**Files:**
- Modify: `src/theme/builtinThemes.js`

- [ ] **Step 1: Trim the semantic imports**

Replace the import block (lines 6–12) with only the two surviving presets:

```javascript
import { PLVS_SEMANTIC_DARK, PLVS_SEMANTIC_LIGHT } from "./shadcnSemanticPreset.js";
```

- [ ] **Step 2: Update the `ThemeId` typedef**

Change the typedef (line 2) to:

```javascript
 * @typedef {"plvs-dark" | "plvs-light"} ThemeId
```

- [ ] **Step 3: Delete the dead const blocks**

Delete these top-level `const` declarations entirely (they are only referenced by the removed theme
entries): `CHARTS_PLVS_PHOSPHOR`, `METER_GRADIENT_PHOSPHOR`, `METER_COLOR_OVERRIDES_PHOSPHOR`,
`CHARTS_PLVS_ABYSS`, `METER_GRADIENT_ABYSS`, `METER_COLOR_OVERRIDES_ABYSS`, `CHARTS_PLVS_TUNGSTEN`,
`METER_GRADIENT_TUNGSTEN`, `METER_COLOR_OVERRIDES_TUNGSTEN`. Keep `CHARTS_PLVS_DARK`,
`CHARTS_PLVS_LIGHT`, and `METER_GRADIENT_PLVS`.

- [ ] **Step 4: Reduce `BUILTIN_THEMES` to two entries**

Replace the whole `BUILTIN_THEMES` object with:

```javascript
/** @type {Record<ThemeId, BuiltinTheme>} */
export const BUILTIN_THEMES = {
  "plvs-dark": {
    id: "plvs-dark",
    label: "Dark",
    semantic: PLVS_SEMANTIC_DARK,
    charts: CHARTS_PLVS_DARK,
    meterGradient: METER_GRADIENT_PLVS,
    colorScheme: "dark",
  },
  "plvs-light": {
    id: "plvs-light",
    label: "Light",
    semantic: PLVS_SEMANTIC_LIGHT,
    charts: CHARTS_PLVS_LIGHT,
    meterGradient: METER_GRADIENT_PLVS,
    colorScheme: "light",
  },
};
```

- [ ] **Step 5: Reduce `THEME_IDS` to two ids**

Replace the `THEME_IDS` declaration with:

```javascript
/** @type {readonly ThemeId[]} */
export const THEME_IDS = Object.freeze(
  /** @type {ThemeId[]} */ (["plvs-dark", "plvs-light"])
);
```

- [ ] **Step 6: Run the theme tests to verify they pass**

Run: `npx vitest run src/theme/builtinThemes.test.js src/preferences/themeResolve.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/theme/builtinThemes.js
git commit -m "feat(theme): remove phosphor, tungsten, and abyss builtin themes"
```

---

### Task 3: Remove the three semantic presets from `shadcnSemanticPreset.js`

**Files:**
- Modify: `src/theme/shadcnSemanticPreset.js`

- [ ] **Step 1: Confirm no remaining importers**

Run: `grep -rn -e "PLVS_SEMANTIC_ABYSS" -e "PLVS_SEMANTIC_TUNGSTEN" -e "PLVS_SEMANTIC_PHOSPHOR" src`
Expected: matches only inside `src/theme/shadcnSemanticPreset.js` itself (the export definitions).
If anything else matches, stop and fix that consumer first.

- [ ] **Step 2: Delete the three export blocks**

Delete the `export const PLVS_SEMANTIC_ABYSS = { ... };`, `export const PLVS_SEMANTIC_TUNGSTEN =
{ ... };`, and `export const PLVS_SEMANTIC_PHOSPHOR = { ... };` declarations in full. Keep
`SHADCN_NEUTRAL_SEMANTIC_LIGHT`, `SHADCN_NEUTRAL_SEMANTIC_DARK`, `PLVS_SEMANTIC_LIGHT`,
`PLVS_SEMANTIC_DARK`, and everything below (`SHADCN_SEMANTIC_CSS_VAR_BINDINGS`, `oklchToHex`,
`buildThemeFallbackCss`, `oklchSafe`, `applyShadcnSemanticTokensToDocument`).

- [ ] **Step 3: Run the full front-end test suite + lint**

Run: `npm run test`
Expected: PASS (no suite references the removed presets).
Run: `npx eslint src/theme/shadcnSemanticPreset.js src/theme/builtinThemes.js`
Expected: no errors (no unused vars left behind).

- [ ] **Step 4: Commit**

```bash
git add src/theme/shadcnSemanticPreset.js
git commit -m "refactor(theme): drop unused phosphor/tungsten/abyss semantic presets"
```

---

### Task 4: Full verification + first-paint regeneration

**Files:**
- (Generated) `src/generated/theme-fallbacks.css`

- [ ] **Step 1: Regenerate first-paint CSS and confirm it is unchanged**

Run: `npm run theme:generate`
Expected: `src/generated/theme-fallbacks.css` is generated from `plvs-dark` only (ADR 0002). Since
this plan does not touch the dark semantic, `git status` should show **no change** to that file. If
it changed, investigate before continuing.

- [ ] **Step 2: Run the full project check**

Run: `npm run check`
Expected: PASS (front-end format + lint + test + build + version + Rust fmt/clippy/test).

- [ ] **Step 3: Manual smoke (optional but recommended)**

Launch the app, open Settings, confirm the theme picker lists only **Dark** and **Light**. Set
appearance to a fixed theme, quit, and relaunch to confirm no console error and the app shows Dark.

- [ ] **Step 4: Final commit (only if Step 1 produced changes or Step 2 auto-fixed formatting)**

```bash
git add -A
git commit -m "chore(theme): regenerate first-paint css after theme removal"
```

If `git status` is clean after Steps 1–2, skip this commit.

---

## Self-Review

- **Spec coverage (§6):** removes the three themes and their semantic/charts/gradient/override blocks
  (Tasks 2–3); migration fallback verified by the `it.each` test (Task 1, Step 3) — matches the
  spec's "concrete migration tests". Note: §6 also lists ADR/doc updates enumerating five themes;
  those are documentation and are handled in Plan 5 (doc rewrite), not here.
- **`meterColorOverrides` / `meterColorBridge.js`:** intentionally left intact this plan (still used
  by dark/light through the bridge); removed in Plan 3 per spec §5. No contradiction.
- **Placeholder scan:** none — every step shows exact code/commands.
- **Type consistency:** `ThemeId` reduced to the two-id union in one place (Task 2 Step 2); `THEME_IDS`
  and `BUILTIN_THEMES` updated to match; `isThemeId`, `THEME_SELECT_OPTIONS`, `getBuiltinTheme` are
  unchanged and remain correct over the reduced set.
