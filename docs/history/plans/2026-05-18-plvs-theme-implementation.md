# PLVS Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all three AudioMeter themes with a single `plvs-dark` theme using warm gray + orange brand color, and clean up all legacy `--ui-color-*` token names across the codebase.

**Architecture:** Three-pass approach — (1) rebuild the theme data layer (semantic preset → theme bundle → color bridge), (2) update the token writer (applyDocumentTheme), (3) clean up consumers (components). Each pass is independently testable.

**Tech Stack:** Vitest, React, Tailwind CSS, CSS custom properties, shadcn/ui, `npm run theme:generate` (script that regenerates `src/generated/theme-fallbacks.css`)

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `src/theme/shadcnSemanticPreset.js` | Modify | Add `PLVS_SEMANTIC_DARK`; keep `SHADCN_NEUTRAL_*` as reference; update `buildThemeFallbackCss` export |
| `src/theme/builtinThemes.js` | Modify | Remove 3 old themes; add single `plvs-dark` entry with orange chart palette |
| `src/theme/meterColorBridge.js` | Rewrite | Remove cyan-based derivation; hardcode orange-based signal + metric colors |
| `src/preferences/applyDocumentTheme.js` | Modify | Rename all `--ui-color-metric-*` and `--ui-color-loudness-*` to new token names; remove deleted tokens |
| `src/preferences/data.js` | Modify | Change `sectionGapPx: 8` → `sectionGapRem: 0.55` |
| `src/preferences/themeResolve.js` | Modify | Replace `audiometer-dark/light/ember` references with `plvs-dark` |
| `src/components/panels/LoudnessHistoryChart.jsx` | Modify | `--ui-color-loudness-target-line` → `--ui-chart-target-line` |
| `src/components/panels/LoudnessStatsPanel.jsx` | Modify | All `--ui-color-metric-*` → new names |
| `src/components/ui/sheet.jsx` | Modify | Remove `--ui-color-settings-overlay`; inline Tailwind class |
| `src/generated/theme-fallbacks.css` | Regenerate | `npm run theme:generate` |
| `src/theme/themeFallbacks.test.js` | Modify | Reference `PLVS_SEMANTIC_DARK`; check `--primary: #fb923c` |
| `src/preferences/themeResolve.test.js` | Modify | Replace all `audiometer-*` IDs with `plvs-dark` |
| `docs/design-tokens.md` | Rewrite | Align with spec; remove all migration notes |

---

## Task 1: New PLVS Dark semantic preset

**Files:**
- Modify: `src/theme/shadcnSemanticPreset.js`
- Modify: `src/theme/themeFallbacks.test.js`

- [ ] **Step 1: Update the failing test first**

Replace the two existing test assertions in `src/theme/themeFallbacks.test.js`:

```js
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLVS_SEMANTIC_DARK, buildThemeFallbackCss } from "./shadcnSemanticPreset.js";
import { UI_PREFERENCES } from "../preferences/data.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const generatedPath = join(__dirname, "../generated/theme-fallbacks.css");

describe("buildThemeFallbackCss", () => {
  it("emits :root only with plvs-dark primary accent", () => {
    const css = buildThemeFallbackCss(PLVS_SEMANTIC_DARK, UI_PREFERENCES.radii.card);
    expect(css).toContain(":root {");
    expect(css).not.toContain(".dark {");
    expect(css).toContain("--primary: #fb923c;");
  });

  it("matches the committed generated file (run npm run theme:generate after editing presets)", () => {
    const expected = buildThemeFallbackCss(PLVS_SEMANTIC_DARK, UI_PREFERENCES.radii.card);
    const onDisk = readFileSync(generatedPath, "utf8");
    expect(onDisk).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```
npm test -- src/theme/themeFallbacks.test.js
```

Expected: FAIL — `PLVS_SEMANTIC_DARK is not exported`

- [ ] **Step 3: Add `PLVS_SEMANTIC_DARK` to `src/theme/shadcnSemanticPreset.js`**

Add after the existing `AUDIOMETER_SEMANTIC_DARK` export (keep old exports — they'll be removed in Task 2):

```js
/** PLVS Dark — warm gray shell + orange brand. Replaces audiometer-dark. */
export const PLVS_SEMANTIC_DARK = {
  background: "oklch(0.13 0.01 55)",
  foreground: "oklch(0.96 0.006 70)",
  card: "oklch(0.195 0.012 50)",
  cardForeground: "oklch(0.96 0.006 70)",
  popover: "oklch(0.195 0.012 50)",
  popoverForeground: "oklch(0.96 0.006 70)",
  primary: "#fb923c",
  primaryForeground: "oklch(0.13 0.01 55)",
  secondary: "oklch(0.258 0.012 50)",
  secondaryForeground: "oklch(0.96 0.006 70)",
  muted: "oklch(0.258 0.012 50)",
  mutedForeground: "oklch(0.63 0.015 55)",
  accent: "oklch(0.258 0.012 50)",
  accentForeground: "oklch(0.96 0.006 70)",
  destructive: "oklch(0.65 0.22 25)",
  destructiveForeground: "oklch(0.985 0 0)",
  border: "oklch(1 0 0 / 9%)",
  input: "oklch(1 0 0 / 14%)",
  ring: "#fb923c",
  chart1: "oklch(0.646 0.222 41.116)",
  chart2: "oklch(0.6 0.118 184.704)",
  chart3: "oklch(0.398 0.07 227.392)",
  chart4: "oklch(0.828 0.189 84.429)",
  chart5: "oklch(0.769 0.188 70.08)",
};
```

- [ ] **Step 4: Run test — should pass the export check, fail the generated-file check**

```
npm test -- src/theme/themeFallbacks.test.js
```

Expected: first test PASSES, second test FAILS (generated file not yet regenerated)

- [ ] **Step 5: Commit**

```
git add src/theme/shadcnSemanticPreset.js src/theme/themeFallbacks.test.js
git commit -m "feat(theme): add PLVS_SEMANTIC_DARK semantic preset"
```

---

## Task 2: Rebuild theme bundle

**Files:**
- Modify: `src/theme/builtinThemes.js`
- Modify: `src/preferences/themeResolve.js`
- Modify: `src/preferences/themeResolve.test.js`

- [ ] **Step 1: Update themeResolve tests first**

Replace the full content of `src/preferences/themeResolve.test.js`:

```js
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THEME_ID,
  parsePersistedUiStateJson,
  resolveThemeId,
  THEME_IDS,
} from "./themeResolve.js";

describe("resolveThemeId", () => {
  it("resolves to plvs-dark for system dark preference", () => {
    expect(resolveThemeId({ appearance: "system", themeId: null }, true)).toBe("plvs-dark");
  });

  it("resolves to plvs-dark for system light preference (no light theme yet)", () => {
    expect(resolveThemeId({ appearance: "system", themeId: null }, false)).toBe("plvs-dark");
  });

  it("ignores stored themeId when appearance is system", () => {
    expect(resolveThemeId({ appearance: "system", themeId: "plvs-dark" }, true)).toBe("plvs-dark");
  });

  it("uses stored themeId when appearance is fixed and valid", () => {
    expect(resolveThemeId({ appearance: "fixed", themeId: "plvs-dark" }, true)).toBe("plvs-dark");
  });

  it("falls back to plvs-dark for fixed appearance with missing or invalid themeId", () => {
    expect(resolveThemeId({ appearance: "fixed", themeId: null }, false)).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId({ appearance: "fixed", themeId: "" }, false)).toBe(DEFAULT_THEME_ID);
    expect(resolveThemeId({ appearance: "fixed", themeId: "audiometer-dark" }, false)).toBe(
      DEFAULT_THEME_ID
    );
    expect(resolveThemeId({ appearance: "fixed", themeId: "unknown-theme" }, false)).toBe(
      DEFAULT_THEME_ID
    );
  });

  it("defaults appearance to system when fields missing", () => {
    expect(resolveThemeId({}, true)).toBe("plvs-dark");
    expect(resolveThemeId({}, false)).toBe("plvs-dark");
  });
});

describe("parsePersistedUiStateJson", () => {
  it("defaults appearance system and themeId null for empty or invalid JSON", () => {
    expect(parsePersistedUiStateJson(null)).toEqual({ appearance: "system", themeId: null });
    expect(parsePersistedUiStateJson("")).toEqual({ appearance: "system", themeId: null });
    expect(parsePersistedUiStateJson("not-json")).toEqual({ appearance: "system", themeId: null });
  });

  it("reads appearance and themeId when present", () => {
    expect(
      parsePersistedUiStateJson(JSON.stringify({ appearance: "fixed", themeId: "plvs-dark" }))
    ).toEqual({ appearance: "fixed", themeId: "plvs-dark" });
  });

  it("legacy uiMode-only blobs are ignored", () => {
    expect(parsePersistedUiStateJson(JSON.stringify({ uiMode: "dark" }))).toEqual({
      appearance: "system",
      themeId: null,
    });
  });
});

describe("resolveThemeId DEV warnings", () => {
  it("warns in DEV for unknown fixed themeId", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEV", true);
    resolveThemeId({ appearance: "fixed", themeId: "audiometer-dark" }, false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("does not warn in production for unknown fixed themeId", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DEV", false);
    resolveThemeId({ appearance: "fixed", themeId: "audiometer-dark" }, false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("THEME_IDS", () => {
  it("contains only plvs-dark", () => {
    expect(THEME_IDS).toContain("plvs-dark");
    expect(THEME_IDS).not.toContain("audiometer-dark");
    expect(THEME_IDS).not.toContain("audiometer-light");
    expect(THEME_IDS).not.toContain("audiometer-ember");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```
npm test -- src/preferences/themeResolve.test.js
```

Expected: FAIL — `"plvs-dark"` not in THEME_IDS

- [ ] **Step 3: Rewrite `src/theme/builtinThemes.js`**

Replace the entire file:

```js
/**
 * Builtin colour themes.
 * @typedef {"plvs-dark"} ThemeId
 */

import { PLVS_SEMANTIC_DARK } from "./shadcnSemanticPreset.js";

/** @typedef {import("./shadcnSemanticPreset.js").ShadcnSemantic} ShadcnSemantic */

/**
 * @typedef {{ loudnessHistory: Record<string, unknown>; vectorscope: Record<string, unknown>; spectrum: Record<string, unknown>; }} ChartsBundle
 * @typedef {{ top: string; mid: string; midStopPercent: number; bottom: string; }} MeterGradient
 * @typedef {{ id: ThemeId; label: string; semantic: ShadcnSemantic; charts: ChartsBundle; meterGradient: MeterGradient; colorScheme: "light"|"dark"; }} BuiltinTheme
 */

export const DEFAULT_THEME_ID = /** @type {ThemeId} */ ("plvs-dark");

const CHARTS_PLVS_DARK = {
  loudnessHistory: {
    momentaryStroke: "#fb923c",
    momentaryStrokeSnap: "#fcd34d",
    momentaryStrokeWidth: 1.2,
    shortTermStroke: "#e8824a",
    shortTermStrokeSnap: "#fed7aa",
    shortTermStrokeWidth: 1.2,
    shortTermOpacity: 0.95,
    selectionStroke: "#fcd34d",
    selectionStrokeWidth: 1.2,
    historyGridLineColor: "color-mix(in srgb, var(--border) 10%, transparent)",
  },
  vectorscope: {
    strokeLive: "#fb923c",
    strokeSnap: "#fcd34d",
    strokeWidth: 1,
    axisOpacity: 0.8,
    gridDiagInsetPct: 1.2,
    plotRadius: 240,
    gridDiagStroke: "color-mix(in srgb, var(--border) 80%, transparent)",
    gridDiagDash: "2.6 3.4",
  },
  spectrum: {
    strokeLive: "#fb923c",
    strokeSnap: "#fcd34d",
    strokeWidth: 1.5,
    fillOpacityTop: 0.22,
    fillOpacityBottom: 0.03,
  },
};

const METER_GRADIENT_PLVS = {
  top: "#f97373",
  mid: "#fbbf24",
  midStopPercent: 46,
  bottom: "#34d399",
};

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
};

/** @type {readonly ThemeId[]} */
export const THEME_IDS = Object.freeze(/** @type {ThemeId[]} */ (["plvs-dark"]));

/** @param {unknown} id @returns {id is ThemeId} */
export function isThemeId(id) {
  return typeof id === "string" && THEME_IDS.includes(/** @type {ThemeId} */ (id));
}

export const THEME_SELECT_OPTIONS = Object.freeze(
  THEME_IDS.map((id) => ({ id, label: BUILTIN_THEMES[id].label }))
);

/** @param {ThemeId} id @returns {BuiltinTheme} */
export function getBuiltinTheme(id) {
  return BUILTIN_THEMES[id] ?? BUILTIN_THEMES[DEFAULT_THEME_ID];
}
```

- [ ] **Step 4: Update `src/preferences/themeResolve.js`**

Replace the `resolveThemeId` function body only (the imports and `parsePersistedUiStateJson` stay the same):

```js
/**
 * @param {{ appearance?: unknown; themeId?: unknown }} shell
 * @param {boolean} systemPrefersDark
 * @returns {import("../theme/builtinThemes.js").ThemeId}
 */
export function resolveThemeId(shell, systemPrefersDark) {
  const appearance = shell?.appearance === "fixed" ? "fixed" : "system";
  if (appearance === "system") {
    return DEFAULT_THEME_ID;
  }
  const rawId = shell?.themeId;
  const id = rawId == null || rawId === "" ? null : String(rawId);
  if (!isThemeId(id)) {
    if (import.meta.env.DEV && id != null && id !== "") {
      console.warn(`[PLVS] Unknown themeId "${id}"; falling back to ${DEFAULT_THEME_ID}.`);
    }
    return DEFAULT_THEME_ID;
  }
  return id;
}
```

- [ ] **Step 5: Run tests**

```
npm test -- src/preferences/themeResolve.test.js
```

Expected: all PASS

- [ ] **Step 6: Run full test suite to catch any regressions**

```
npm test
```

Expected: all PASS (typography test, history tests etc. unaffected)

- [ ] **Step 7: Commit**

```
git add src/theme/builtinThemes.js src/preferences/themeResolve.js src/preferences/themeResolve.test.js
git commit -m "feat(theme): replace audiometer themes with plvs-dark"
```

---

## Task 3: Rewrite meterColorBridge

**Files:**
- Rewrite: `src/theme/meterColorBridge.js`
- Modify: `src/theme/meterColorBridge.test.js` (if exists — check first)

- [ ] **Step 1: Check if a test file exists**

```
ls src/theme/meterColorBridge.test.js
```

If it exists, read it before proceeding. If not, continue.

- [ ] **Step 2: Replace `src/theme/meterColorBridge.js` entirely**

```js
/**
 * Computes PLVS-specific component color values that have no shadcn equivalent.
 * Returns plain CSS color strings consumed by applyDocumentTheme.
 *
 * @param {import("./shadcnSemanticPreset.js").ShadcnSemantic} _s  Unused for now (dark only). Reserved for future light theme.
 * @param {"light"|"dark"} _colorScheme  Reserved for future light theme.
 */
export function buildMeterColorBridge(_s, _colorScheme) {
  return {
    peakSamplePeak: "#fb923c",
    peakTruePeak: "#f97373",
    tpMaxText: "#f97373",
    correlation: {
      bad: "#f97373",
      mid: "#9e9488",
      good: "#34d399",
    },
    metricRowBg: "rgba(255,255,255,0.04)",
    metricRowHoverBg: "rgba(255,255,255,0.07)",
    metricRowToggleOnBorder: "rgba(251,146,60,0.4)",
    metricRowToggleOnBg: "rgba(251,146,60,0.10)",
    metricRowToggleOnGlow: "rgba(251,146,60,0.25)",
    metricToggleOnLabel: "#fb923c",
    loudnessTargetLine: "rgba(251,146,60,0.4)",
  };
}
```

- [ ] **Step 3: Run full test suite**

```
npm test
```

Expected: all PASS (bridge has no dedicated test; callers will be updated in Task 4)

- [ ] **Step 4: Commit**

```
git add src/theme/meterColorBridge.js
git commit -m "refactor(theme): rewrite meterColorBridge with orange-based PLVS colors"
```

---

## Task 4: Update applyDocumentTheme token names

**Files:**
- Modify: `src/preferences/applyDocumentTheme.js`

- [ ] **Step 1: Replace the `applyThemeToDocument` block that writes color bridge tokens**

Find lines 138–155 of `src/preferences/applyDocumentTheme.js` (the block after `applyShadcnSemanticTokensToDocument` call). Replace that block with:

```js
  const bridge = buildMeterColorBridge(theme.semantic, theme.colorScheme);

  setCssVar("--ui-signal-peak-sample", bridge.peakSamplePeak);
  setCssVar("--ui-signal-peak-true", bridge.peakTruePeak);
  setCssVar("--ui-signal-tp-max", bridge.tpMaxText);
  setCssVar("--ui-signal-corr-bad", bridge.correlation.bad);
  setCssVar("--ui-signal-corr-mid", bridge.correlation.mid);
  setCssVar("--ui-signal-corr-good", bridge.correlation.good);
  setCssVar("--ui-metric-row-bg", bridge.metricRowBg);
  setCssVar("--ui-metric-row-hover-bg", bridge.metricRowHoverBg);
  setCssVar("--ui-metric-row-toggle-on-border", bridge.metricRowToggleOnBorder);
  setCssVar("--ui-metric-row-toggle-on-bg", bridge.metricRowToggleOnBg);
  setCssVar("--ui-metric-row-toggle-on-glow", bridge.metricRowToggleOnGlow);
  setCssVar("--ui-metric-toggle-on-label", bridge.metricToggleOnLabel);
  setCssVar("--ui-chart-target-line", bridge.loudnessTargetLine);
```

(Removed: `--ui-color-inset-dark`, `--ui-color-settings-overlay`, `--ui-color-target-value`, `--ui-color-metric-toggle-on-unit`)

- [ ] **Step 2: Run full test suite**

```
npm test
```

Expected: all PASS

- [ ] **Step 3: Commit**

```
git add src/preferences/applyDocumentTheme.js
git commit -m "refactor(theme): rename --ui-color-* bridge tokens to new namespaced names"
```

---

## Task 5: Align panel-gap with shell-gap

**Files:**
- Modify: `src/preferences/data.js`
- Modify: `src/preferences/applyDocumentTheme.js`

- [ ] **Step 1: Update `data.js` — rename `sectionGapPx` to `sectionGapRem`**

In `src/preferences/data.js`, inside `layout.splitters`, change:

```js
splitters: {
  sectionGapPx: 8,        // ← remove this line
  sectionGapRem: 0.55,    // ← add this line (matches --ui-shell-gap)
  barThicknessPx: 1,
  loudnessGapPx: 8,
},
```

- [ ] **Step 2: Update `applyLayoutToDocument` to use the new key**

In `src/preferences/applyDocumentTheme.js`, find the panel-gap line:

```js
setCssVar("--ui-panel-gap", `${splitters.sectionGapPx}px`);
```

Replace with:

```js
setCssVar("--ui-panel-gap", `${splitters.sectionGapRem}rem`);
```

- [ ] **Step 3: Run full test suite**

```
npm test
```

Expected: all PASS

- [ ] **Step 4: Commit**

```
git add src/preferences/data.js src/preferences/applyDocumentTheme.js
git commit -m "feat(spacing): align panel-gap with shell-gap (0.55rem)"
```

---

## Task 6: Clean up component consumers

**Files:**
- Modify: `src/components/panels/LoudnessHistoryChart.jsx`
- Modify: `src/components/panels/LoudnessStatsPanel.jsx`
- Modify: `src/components/ui/sheet.jsx`

- [ ] **Step 1: Update `LoudnessHistoryChart.jsx`**

Find both usages of `--ui-color-loudness-target-line` (lines ~240 and ~251) and rename to `--ui-chart-target-line`:

Line ~240:
```js
"color-mix(in srgb, var(--ui-chart-target-line) 12%, transparent)",
```

Line ~251:
```js
borderTopColor: "var(--ui-chart-target-line)",
```

- [ ] **Step 2: Update `LoudnessStatsPanel.jsx`**

Four token renames + one merge. Current usages to replace:

| Old | New |
|-----|-----|
| `--ui-color-metric-toggle-on-label` | `--ui-metric-toggle-on-label` |
| `--ui-color-metric-toggle-on-unit` | `--ui-metric-toggle-on-label` (merge — same color) |
| `--ui-color-metric-row-bg` | `--ui-metric-row-bg` |
| `--ui-color-metric-row-hover-bg` | `--ui-metric-row-hover-bg` |
| `--ui-color-metric-row-toggle-on-border` | `--ui-metric-row-toggle-on-border` |
| `--ui-color-metric-row-toggle-on-bg` | `--ui-metric-row-toggle-on-bg` |
| `--ui-color-metric-row-toggle-on-glow` | `--ui-metric-row-toggle-on-glow` |

- [ ] **Step 3: Update `sheet.jsx`**

Find line ~30 which has `bg-[color:var(--ui-color-settings-overlay)]`. Replace with a hardcoded Tailwind class:

```js
"bg-black/55 backdrop-blur-sm",
```

(Remove the CSS var reference entirely — this token is retired.)

- [ ] **Step 4: Verify no old `--ui-color-*` references remain in component files**

```
grep -r "\-\-ui-color-" src/ --include="*.jsx" --include="*.js" --include="*.css"
```

Expected: only `src/uiPreferences.js` (comment only) and `src/theme/meterColorBridge.js` docstring. No component files.

- [ ] **Step 5: Run full test suite**

```
npm test
```

Expected: all PASS

- [ ] **Step 6: Commit**

```
git add src/components/panels/LoudnessHistoryChart.jsx src/components/panels/LoudnessStatsPanel.jsx src/components/ui/sheet.jsx
git commit -m "refactor(components): replace retired --ui-color-* tokens with new names"
```

---

## Task 7: Regenerate fallback CSS + fix failing test

**Files:**
- Regenerate: `src/generated/theme-fallbacks.css`

- [ ] **Step 1: Run the generator**

```
npm run theme:generate
```

Expected: `src/generated/theme-fallbacks.css` updated. Check that it contains `--primary: #fb923c` and warm oklch background values.

- [ ] **Step 2: Run the fallback test — should now fully pass**

```
npm test -- src/theme/themeFallbacks.test.js
```

Expected: both tests PASS (including the generated-file match test)

- [ ] **Step 3: Run full test suite**

```
npm test
```

Expected: all PASS

- [ ] **Step 4: Commit**

```
git add src/generated/theme-fallbacks.css
git commit -m "chore(theme): regenerate fallback CSS for plvs-dark"
```

---

## Task 8: Rewrite design-tokens.md

**Files:**
- Rewrite: `docs/design-tokens.md`

- [ ] **Step 1: Replace `docs/design-tokens.md` to match the finalized spec**

The new content should mirror `docs/superpowers/specs/2026-05-18-plvs-theme-design.md` but formatted as a reference doc (not a design decision log). Key differences from current file:

- Remove all "Migration:" notes (migrations are done)
- Remove all "Retired Tokens" section
- Remove `AUDIOMETER_*` references
- Add the new orange chart token values
- Update the panel-gap note to say `= --ui-shell-gap (0.55rem)`
- Add the `--ui-metric-row-*` and `--ui-chart-target-line` tokens to their respective sections

The doc structure should be:

```
# Design Token Specification
## Architecture (3-layer diagram)
## Color Tokens
  ### Shadcn Semantic
  ### Component: Meter
  ### Component: Chart
  ### Component: Signal
  ### Component: Metric Row
## Typography Tokens
## Spacing Tokens
  ### Shell / Header / Footer / Panel / Metric Row / Modal
## Radius Tokens
```

No migration notes. No retired tokens. This is the current truth.

- [ ] **Step 2: Commit**

```
git add docs/design-tokens.md
git commit -m "docs: rewrite design-tokens.md to reflect plvs-dark implementation"
```

---

## Quick verification after all tasks

```
npm test
grep -r "\-\-ui-color-" src/ --include="*.jsx" --include="*.js"
grep -r "audiometer-dark\|audiometer-light\|audiometer-ember" src/ --include="*.jsx" --include="*.js"
```

All three should be clean:
1. All tests pass
2. No `--ui-color-*` in component/preference files (only comments/docs allowed)
3. No old theme ID strings in source files
