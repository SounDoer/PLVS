# Theme Token Refactor — Plan 2: Seed / Derive Color Model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace each theme's hand-filled `charts` color fields, `meterGradient` color stops, and the `meterColorBridge.js` signal colors with a small set of **seeds** (`accent`, `accentSecondary`, `signal{good,warn,bad}`) plus a pure `buildThemeTokens(theme)` that **derives** every instrument color via OKLCH transforms. Token **names are unchanged** this plan (renamed in Plan 3); derived values are tuned to land **close to** today's colors (exact polish is a later pass).

**Architecture:** Add an OKLCH color-transform utility. Each theme keeps `id/label/colorScheme/semantic` and its **geometry** (stroke widths, opacities, dash, `midStopPercent`, etc. — these differ per theme and stay where they are this plan; they move to global in Plan 3). `buildThemeTokens(theme)` returns a `{ cssVarName: value }` map of all instrument **color** tokens; `applyThemeToDocument` writes that map plus the existing geometry. `meterColorBridge.js` is deleted (signal seed supersedes it).

**Tech Stack:** JavaScript (ESM), Vitest. OKLCH ↔ sRGB color math.

**Spec:** `docs/working/superpowers/specs/2026-06-19-theme-token-seed-refactor-design.md` §3, §4.1, §4.2.

**Roadmap:** Plan 2 of 5. Prior: Plan 1 (themes deleted) is merged into this branch. After: Plan 3 (rename + dead-token purge + geometry→global), Plan 4 (spectrogram colormap), Plan 5 (docs).

**Decisions locked with the user:** (1) full color model lands in one plan; (2) derivation is *approximate* — tests assert closeness to anchors, not exact equality, and `dark`/`light` may shift slightly now (final values tuned in the polish pass); (3) `light`'s meter gradient unifies under `light`'s `signal` seed (it currently shares the bright dark gradient via `METER_GRADIENT_PLVS`), so light meter bars will shift to light-tuned signal colors — this is the intended regularization.

---

## Anchor Reference (current values the derivation should approximate)

These are the existing hand-tuned values. `accent`, `accentSecondary`, and `signal` become **seeds**
(exact, kept verbatim). Everything else is **derived** and only needs to land close.

**Dark seeds:** `accent #fb923c`, `accentSecondary #38bdf8`, `signal { good #34d399, warn #fbbf24, bad #f97373 }`.
**Light seeds:** `accent #e07020`, `accentSecondary #0e7490`, `signal { good #18976a, warn #fbbf24, bad #d03535 }`.

| Derived token (current name) | Dark anchor | Light anchor | Derivation intent |
|------------------------------|-------------|--------------|-------------------|
| `--ui-chart-momentary` (live) | `#fb923c` | `#e07020` | = `accent` |
| `--ui-chart-momentary-snap` | `#fcd34d` | `#b76b00` | accent → **snap** (toward gold, raise contrast vs background: dark lighter / light darker) |
| `--ui-chart-momentary-over` | `#ff5a1f` | `#ff5500` | accent → **over** (toward hot red, raise chroma) |
| `--ui-chart-shortterm` (live) | `#c66a2a` | `#a85224` | accent → **sibling** (reduce L and C) |
| `--ui-chart-shortterm-snap` | `#f2b27a` | `#7a5a18` | sibling → **snap** |
| `--ui-chart-shortterm-over` | `#ff4a0a` | `#ff4a0a` | sibling → **over** |
| `--ui-chart-selection` | `#fcd34d` | `#c07820` | = momentary **snap** |
| `--ui-chart-vectorscope-live` | `#fb923c` | `#e07020` | = `accent` |
| `--ui-chart-vectorscope-snap` | `#fcd34d` | `#b76b00` | = momentary **snap** |
| `--ui-chart-spectrum-live` | `#fb923c` | `#e07020` | = `accent` |
| `--ui-chart-spectrum-snap` | `#fcd34d` | `#b76b00` | = momentary **snap** |
| `--ui-chart-spectrum-live-b` | `#38bdf8` | `#0e7490` | = `accentSecondary` |
| `--ui-chart-spectrum-snap-b` | `#7dd3fc` | `#155e75` | accentSecondary → **snap** (same transform as accent) |
| `--ui-chart-waveform-live` | `#fb923c` | `#e07020` | = `accent` |
| `--ui-signal-peak-sample` | `#fb923c` | `#e07020` | = `accent` |
| `--ui-signal-peak-true` | `#f97373` | `#d03535` | = `signal.bad` |
| `--ui-signal-tp-max` | `#f97373` | `#d03535` | = `signal.bad` |
| `--ui-signal-corr-bad` | `#f97373` | `#d03535` | = `signal.bad` |
| `--ui-signal-corr-good` | `#34d399` | `#18976a` | = `signal.good` |
| `--ui-signal-corr-mid` | `#9e9488` | (from shell) | = `var(--muted-foreground)` (neutral) |
| `--ui-meter-grad-top` | `#f97373` | `#f97373`→`#d03535` | = `signal.bad` (light now unifies) |
| `--ui-meter-grad-mid` | `#fbbf24` | `#fbbf24` | = `signal.warn` |
| `--ui-meter-grad-bottom` | `#34d399` | `#34d399`→`#18976a` | = `signal.good` (light now unifies) |
| `--ui-chart-target-line` | `rgba(251,146,60,0.4)` | `rgba(224,112,32,0.45)` | `accent` at ~0.4 alpha |
| `--ui-metric-row-bg` | `rgba(255,255,255,0.04)` | `rgba(0,0,0,0.04)` | scheme neutral (white/black α) |
| `--ui-metric-row-hover-bg` | `rgba(255,255,255,0.07)` | `rgba(0,0,0,0.08)` | scheme neutral |
| `--ui-metric-row-toggle-on-border` | `rgba(251,146,60,0.4)` | `rgba(224,112,32,0.5)` | `accent` at α |
| `--ui-metric-row-toggle-on-bg` | `rgba(251,146,60,0.10)` | `rgba(224,112,32,0.12)` | `accent` at α |
| `--ui-metric-row-toggle-on-glow` | `rgba(251,146,60,0.25)` | `rgba(224,112,32,0.22)` | `accent` at α |
| `--ui-metric-toggle-on-label` | `#fb923c` | `#e07020` | = `accent` |
| `--ui-loudness-history-grid-line` | `color-mix(in srgb, var(--border) 10%, transparent)` | `…20%…` | neutral, per-scheme % |
| `--ui-vs-grid-diag-stroke` | `color-mix(in srgb, var(--border) 80%, transparent)` | same | neutral |

> Note: `--ui-signal-peak-true`, `--ui-signal-corr-*`, the `--ui-metric-row*`/`--ui-metric-toggle*`
> family, and `--ui-chart-target-line` are **dead** (Plan 1 sweep) and will be **deleted in Plan 3**.
> This plan still derives and writes them (preserving current output exactly where they are still
> set) so Plan 2 changes nothing about which tokens exist — Plan 3 does the purge. Derive them from
> the seeds per the table; do not reintroduce `meterColorBridge.js` for them.

---

### Task 1: OKLCH color-transform utility

**Files:**
- Create: `src/theme/colorTransform.js`
- Test: `src/theme/colorTransform.test.js`

- [ ] **Step 1: Write failing tests**

```javascript
import { describe, it, expect } from "vitest";
import { hexToOklch, oklchToHex, transform } from "./colorTransform.js";

function dist(a, b) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  return Math.hypot(
    ((pa >> 16) & 255) - ((pb >> 16) & 255),
    ((pa >> 8) & 255) - ((pb >> 8) & 255),
    (pa & 255) - (pb & 255)
  );
}

describe("hexToOklch / oklchToHex round-trip", () => {
  it("round-trips common hexes within 2 rgb units", () => {
    for (const hex of ["#fb923c", "#38bdf8", "#34d399", "#000000", "#ffffff"]) {
      const back = oklchToHex(hexToOklch(hex));
      expect(dist(hex, back)).toBeLessThanOrEqual(2);
    }
  });
});

describe("transform", () => {
  it("applies L/C/H deltas in OKLCH space", () => {
    const base = hexToOklch("#fb923c");
    const lighter = transform(base, { dL: 0.1 });
    expect(lighter.L).toBeGreaterThan(base.L);
    expect(lighter.C).toBeCloseTo(base.C, 5);
    expect(lighter.H).toBeCloseTo(base.H, 5);
  });

  it("clamps L to [0,1] and C to >= 0", () => {
    const base = hexToOklch("#ffffff");
    expect(transform(base, { dL: 1 }).L).toBeLessThanOrEqual(1);
    expect(transform(hexToOklch("#000000"), { dC: -1 }).C).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run src/theme/colorTransform.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/theme/colorTransform.js`**

`oklchToHex` here takes an `{ L, C, H }` object (L 0–1, C ≥ 0, H degrees). Reuse the OKLab→sRGB math
already proven in `shadcnSemanticPreset.js`'s string-based `oklchToHex` (copy the conversion, adapt
the input to take an object instead of parsing an `oklch(...)` string). Add the inverse `hexToOklch`
(sRGB → linear → OKLab → OKLCH) and `transform`.

```javascript
// sRGB gamma <-> linear
function toLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function toGamma(c) {
  const x = Math.max(0, Math.min(1, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** @param {string} hex e.g. "#fb923c" @returns {{L:number,C:number,H:number}} */
export function hexToOklch(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C, H };
}

/** @param {{L:number,C:number,H:number}} o @returns {string} hex */
export function oklchToHex({ L, C, H }) {
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;
  const r = toGamma(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3);
  const g = toGamma(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3);
  const bl = toGamma(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3);
  const hx = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(bl)}`;
}

/**
 * @param {{L:number,C:number,H:number}} o
 * @param {{dL?:number,dC?:number,dH?:number}} d
 * @returns {{L:number,C:number,H:number}}
 */
export function transform(o, { dL = 0, dC = 0, dH = 0 }) {
  return {
    L: Math.max(0, Math.min(1, o.L + dL)),
    C: Math.max(0, o.C + dC),
    H: (((o.H + dH) % 360) + 360) % 360,
  };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run src/theme/colorTransform.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/theme/colorTransform.js src/theme/colorTransform.test.js
git commit -m "feat(theme): add OKLCH hex<->oklch conversion and transform helper"
```

---

### Task 2: Add seeds and `buildThemeTokens(theme)`

**Files:**
- Modify: `src/theme/builtinThemes.js`
- Create: `src/theme/buildThemeTokens.js`
- Test: `src/theme/buildThemeTokens.test.js`

- [ ] **Step 1: Add `seeds` to each theme in `builtinThemes.js`**

Add a `seeds` field to the `plvs-dark` and `plvs-light` entries (leave their `semantic`, `charts`
geometry, and `meterGradient` in place for now — geometry stays this plan):

```javascript
  "plvs-dark": {
    id: "plvs-dark",
    label: "Dark",
    semantic: PLVS_SEMANTIC_DARK,
    seeds: {
      accent: "#fb923c",
      accentSecondary: "#38bdf8",
      signal: { good: "#34d399", warn: "#fbbf24", bad: "#f97373" },
    },
    charts: CHARTS_PLVS_DARK,
    meterGradient: METER_GRADIENT_PLVS,
    colorScheme: "dark",
  },
  "plvs-light": {
    id: "plvs-light",
    label: "Light",
    semantic: PLVS_SEMANTIC_LIGHT,
    seeds: {
      accent: "#e07020",
      accentSecondary: "#0e7490",
      signal: { good: "#18976a", warn: "#fbbf24", bad: "#d03535" },
    },
    charts: CHARTS_PLVS_LIGHT,
    meterGradient: METER_GRADIENT_PLVS,
    colorScheme: "light",
  },
```

Add `seeds` to the `BuiltinTheme` typedef (`@property`-style or extend the inline typedef):
`seeds: { accent: string; accentSecondary: string; signal: { good: string; warn: string; bad: string } }`.

- [ ] **Step 2: Write failing tests for `buildThemeTokens`**

The closeness threshold is intentionally loose (≤ 30 rgb-distance) because final values are tuned in
the polish pass; these tests pin "derivation lands near today's colors and is internally consistent."

```javascript
import { describe, it, expect } from "vitest";
import { BUILTIN_THEMES, THEME_IDS } from "./builtinThemes.js";
import { buildThemeTokens } from "./buildThemeTokens.js";

function dist(a, b) {
  const pa = parseInt(a.replace("#", "").slice(0, 6), 16);
  const pb = parseInt(b.replace("#", "").slice(0, 6), 16);
  return Math.hypot(
    ((pa >> 16) & 255) - ((pb >> 16) & 255),
    ((pa >> 8) & 255) - ((pb >> 8) & 255),
    (pa & 255) - (pb & 255)
  );
}

const DARK_ANCHORS = {
  "--ui-chart-momentary": "#fb923c",
  "--ui-chart-momentary-snap": "#fcd34d",
  "--ui-chart-momentary-over": "#ff5a1f",
  "--ui-chart-shortterm": "#c66a2a",
  "--ui-chart-spectrum-live-b": "#38bdf8",
  "--ui-signal-tp-max": "#f97373",
  "--ui-meter-grad-bottom": "#34d399",
};

describe("buildThemeTokens", () => {
  it("returns a value for every instrument color token, for every theme", () => {
    const REQUIRED = [
      "--ui-chart-momentary", "--ui-chart-momentary-snap", "--ui-chart-momentary-over",
      "--ui-chart-shortterm", "--ui-chart-shortterm-snap", "--ui-chart-shortterm-over",
      "--ui-chart-selection",
      "--ui-chart-vectorscope-live", "--ui-chart-vectorscope-snap",
      "--ui-chart-spectrum-live", "--ui-chart-spectrum-snap",
      "--ui-chart-spectrum-live-b", "--ui-chart-spectrum-snap-b",
      "--ui-chart-waveform-live",
      "--ui-signal-peak-sample", "--ui-signal-peak-true", "--ui-signal-tp-max",
      "--ui-signal-corr-bad", "--ui-signal-corr-good", "--ui-signal-corr-mid",
      "--ui-meter-grad-top", "--ui-meter-grad-mid", "--ui-meter-grad-bottom",
      "--ui-chart-target-line",
      "--ui-metric-row-bg", "--ui-metric-row-hover-bg",
      "--ui-metric-row-toggle-on-border", "--ui-metric-row-toggle-on-bg",
      "--ui-metric-row-toggle-on-glow", "--ui-metric-toggle-on-label",
      "--ui-loudness-history-grid-line", "--ui-vs-grid-diag-stroke",
    ];
    for (const id of THEME_IDS) {
      const tokens = buildThemeTokens(BUILTIN_THEMES[id]);
      for (const key of REQUIRED) {
        expect(tokens[key], `${id} ${key}`).toBeTruthy();
      }
    }
  });

  it("derives dark tokens close to the current anchors", () => {
    const t = buildThemeTokens(BUILTIN_THEMES["plvs-dark"]);
    for (const [key, anchor] of Object.entries(DARK_ANCHORS)) {
      expect(dist(t[key], anchor), `${key} ~ ${anchor} got ${t[key]}`).toBeLessThanOrEqual(30);
    }
  });

  it("ties the snap family to one shared snap color", () => {
    const t = buildThemeTokens(BUILTIN_THEMES["plvs-dark"]);
    expect(t["--ui-chart-vectorscope-snap"]).toBe(t["--ui-chart-momentary-snap"]);
    expect(t["--ui-chart-spectrum-snap"]).toBe(t["--ui-chart-momentary-snap"]);
    expect(t["--ui-chart-selection"]).toBe(t["--ui-chart-momentary-snap"]);
  });

  it("maps signal seed straight onto meter/peak/correlation", () => {
    const t = buildThemeTokens(BUILTIN_THEMES["plvs-dark"]);
    const { signal } = BUILTIN_THEMES["plvs-dark"].seeds;
    expect(t["--ui-meter-grad-bottom"]).toBe(signal.good);
    expect(t["--ui-meter-grad-mid"]).toBe(signal.warn);
    expect(t["--ui-meter-grad-top"]).toBe(signal.bad);
    expect(t["--ui-signal-tp-max"]).toBe(signal.bad);
    expect(t["--ui-signal-corr-good"]).toBe(signal.good);
  });

  it("uses the muted-foreground reference for correlation mid", () => {
    const t = buildThemeTokens(BUILTIN_THEMES["plvs-dark"]);
    expect(t["--ui-signal-corr-mid"]).toBe("var(--muted-foreground)");
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `npx vitest run src/theme/buildThemeTokens.test.js`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/theme/buildThemeTokens.js`**

Derive per the Anchor Reference table. Transforms are **scheme-aware**: `snap` raises contrast vs
background (dark → higher L, light → lower L) and shifts H toward gold (~90°); `over` lowers L a bit,
raises C, shifts H toward red (~30°); `sibling` lowers L and C. Start from the constants below and
**adjust them until the "close to the current anchors" test passes** (≤ 30). Keep the structure;
tune the numbers.

```javascript
import { hexToOklch, oklchToHex, transform } from "./colorTransform.js";

// Scheme-aware deltas (starting values; tune to pass the anchor-closeness test).
const SNAP = { dark: { dL: 0.09, dC: 0.0, dH: 34 }, light: { dL: -0.16, dC: -0.02, dH: 18 } };
const OVER = { dark: { dL: -0.1, dC: 0.07, dH: -22 }, light: { dL: -0.05, dC: 0.08, dH: -28 } };
const SIBLING = { dark: { dL: -0.2, dC: -0.03, dH: -4 }, light: { dL: -0.18, dC: -0.02, dH: -6 } };

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * @param {import("./builtinThemes.js").BuiltinTheme} theme
 * @returns {Record<string,string>} cssVarName -> color value (current token names)
 */
export function buildThemeTokens(theme) {
  const scheme = theme.colorScheme === "light" ? "light" : "dark";
  const { accent, accentSecondary, signal } = theme.seeds;

  const snap = (hex) => oklchToHex(transform(hexToOklch(hex), SNAP[scheme]));
  const over = (hex) => oklchToHex(transform(hexToOklch(hex), OVER[scheme]));
  const sibling = (hex) => oklchToHex(transform(hexToOklch(hex), SIBLING[scheme]));

  const accentSnap = snap(accent);
  const shortterm = sibling(accent);
  const gridPct = scheme === "light" ? 20 : 10;
  const rowTint = scheme === "light" ? "0,0,0" : "255,255,255";

  return {
    "--ui-chart-momentary": accent,
    "--ui-chart-momentary-snap": accentSnap,
    "--ui-chart-momentary-over": over(accent),
    "--ui-chart-shortterm": shortterm,
    "--ui-chart-shortterm-snap": snap(shortterm),
    "--ui-chart-shortterm-over": over(shortterm),
    "--ui-chart-selection": accentSnap,
    "--ui-chart-vectorscope-live": accent,
    "--ui-chart-vectorscope-snap": accentSnap,
    "--ui-chart-spectrum-live": accent,
    "--ui-chart-spectrum-snap": accentSnap,
    "--ui-chart-spectrum-live-b": accentSecondary,
    "--ui-chart-spectrum-snap-b": snap(accentSecondary),
    "--ui-chart-waveform-live": accent,
    "--ui-signal-peak-sample": accent,
    "--ui-signal-peak-true": signal.bad,
    "--ui-signal-tp-max": signal.bad,
    "--ui-signal-corr-bad": signal.bad,
    "--ui-signal-corr-good": signal.good,
    "--ui-signal-corr-mid": "var(--muted-foreground)",
    "--ui-meter-grad-top": signal.bad,
    "--ui-meter-grad-mid": signal.warn,
    "--ui-meter-grad-bottom": signal.good,
    "--ui-chart-target-line": rgba(accent, 0.4),
    "--ui-metric-row-bg": `rgba(${rowTint},0.04)`,
    "--ui-metric-row-hover-bg": `rgba(${rowTint},${scheme === "light" ? 0.08 : 0.07})`,
    "--ui-metric-row-toggle-on-border": rgba(accent, scheme === "light" ? 0.5 : 0.4),
    "--ui-metric-row-toggle-on-bg": rgba(accent, scheme === "light" ? 0.12 : 0.1),
    "--ui-metric-row-toggle-on-glow": rgba(accent, scheme === "light" ? 0.22 : 0.25),
    "--ui-metric-toggle-on-label": accent,
    "--ui-loudness-history-grid-line": `color-mix(in srgb, var(--border) ${gridPct}%, transparent)`,
    "--ui-vs-grid-diag-stroke": "color-mix(in srgb, var(--border) 80%, transparent)",
  };
}
```

- [ ] **Step 5: Run and tune until PASS**

Run: `npx vitest run src/theme/buildThemeTokens.test.js`
Expected: PASS. If the closeness test fails for a token, adjust the relevant `SNAP`/`OVER`/`SIBLING`
delta for that scheme (do **not** special-case individual tokens — keep the transforms general).

- [ ] **Step 6: Commit**

```bash
git add src/theme/builtinThemes.js src/theme/buildThemeTokens.js src/theme/buildThemeTokens.test.js
git commit -m "feat(theme): derive instrument colors from seeds via buildThemeTokens"
```

---

### Task 3: Wire `applyThemeToDocument` to the derived tokens; drop the bridge

**Files:**
- Modify: `src/preferences/applyDocumentTheme.js`

- [ ] **Step 1: Replace the color writes with the derived map**

In `applyThemeToDocument`, remove the `buildMeterColorBridge` import and call, and replace the block
that hand-writes each color token (the `setCssVar("--ui-signal-*"...)`, `setCssVar("--ui-metric-*"...)`,
`setCssVar("--ui-chart-*"...)` color lines, and the `--ui-meter-grad-top/mid/bottom` color lines) with
a single loop over `buildThemeTokens(theme)`:

```javascript
import { buildThemeTokens } from "../theme/buildThemeTokens.js";
// (remove: import { buildMeterColorBridge } from "../theme/meterColorBridge.js";)

// ...inside applyThemeToDocument, after applyShadcnSemanticTokensToDocument(theme.semantic):
  const tokens = buildThemeTokens(theme);
  for (const [name, value] of Object.entries(tokens)) {
    setCssVar(name, value);
  }
```

**Keep** the geometry writes that read `theme.charts.*` and `theme.meterGradient.midStopPercent`
(stroke widths, opacities, `--ui-meter-grad-mid-stop`, `--ui-lh-*`, `--ui-vs-*` numeric, `--ui-sp-*`,
spectrum fill opacities, dash, `--ui-loudness-history-grid-line` is now in the derived map so remove
its geometry-side write if duplicated). Geometry relocation is Plan 3 — do not move it now.

- [ ] **Step 2: Verify no other consumer reads the bridge**

Run: `grep -rn "meterColorBridge\|buildMeterColorBridge" src`
Expected: matches only in `src/theme/meterColorBridge.js` and `src/theme/meterColorBridge.test.js`
(deleted next task). If `applyDocumentTheme.js` still matches, you missed the import removal.

- [ ] **Step 3: Run the theme + preferences tests**

Run: `npx vitest run src/preferences src/theme`
Expected: PASS (the `applyDocumentTheme` tests, if any, still pass; theme tests pass).

- [ ] **Step 4: Commit**

```bash
git add src/preferences/applyDocumentTheme.js
git commit -m "refactor(theme): write derived seed tokens, drop meterColorBridge usage"
```

---

### Task 4: Remove dead color data and `meterColorBridge.js`

**Files:**
- Delete: `src/theme/meterColorBridge.js`, `src/theme/meterColorBridge.test.js`
- Modify: `src/theme/builtinThemes.js` (strip color fields now derived)
- Modify: `src/theme/builtinThemes.test.js` (loop tests read derived tokens)

- [ ] **Step 1: Delete the bridge files**

```bash
git rm src/theme/meterColorBridge.js src/theme/meterColorBridge.test.js
```

- [ ] **Step 2: Strip the now-derived color fields from the `CHARTS_*` and `METER_GRADIENT_*` consts**

In `builtinThemes.js`, remove from `CHARTS_PLVS_DARK` and `CHARTS_PLVS_LIGHT` the color fields that
`buildThemeTokens` now derives, keeping only geometry:
- `loudnessHistory`: keep `momentaryStrokeWidth`, `shortTermStrokeWidth`, `shortTermOpacity`,
  `selectionStrokeWidth`. Remove `momentaryStroke`, `momentaryStrokeSnap`, `momentaryStrokeOver`,
  `shortTermStroke`, `shortTermStrokeSnap`, `shortTermStrokeOver`, `selectionStroke`,
  `historyGridLineColor`.
- `vectorscope`: keep `strokeWidth`, `axisOpacity`, `gridDiagInsetPct`, `plotRadius`, `gridDiagDash`.
  Remove `strokeLive`, `strokeSnap`, `gridDiagStroke`.
- `spectrum`: keep `strokeWidth`, `fillOpacityTop`, `fillOpacityBottom`. Remove `strokeLive`,
  `strokeSnap`, `strokeLiveB`, `strokeSnapB`.
- `waveform`: keep `fillOpacity`, `strokeWidth`. Remove `stroke`.

Replace `METER_GRADIENT_PLVS` with geometry only:

```javascript
const METER_GRADIENT_PLVS = { midStopPercent: 46 };
```

- [ ] **Step 3: Update the loop tests in `builtinThemes.test.js` to read derived tokens**

The three loop tests currently read `BUILTIN_THEMES[id].charts.*` color fields. Change them to derive
via `buildThemeTokens`. Replace the `getSnapshotTokens` helper and the color assertions:

```javascript
import { buildThemeTokens } from "./buildThemeTokens.js";

function getSnapshotTokens(themeId) {
  const t = buildThemeTokens(BUILTIN_THEMES[themeId]);
  return {
    momentaryLive: t["--ui-chart-momentary"],
    momentarySnap: t["--ui-chart-momentary-snap"],
    shortTermLive: t["--ui-chart-shortterm"],
    shortTermSnap: t["--ui-chart-shortterm-snap"],
    vectorscopeLive: t["--ui-chart-vectorscope-live"],
    vectorscopeSnap: t["--ui-chart-vectorscope-snap"],
    spectrumLive: t["--ui-chart-spectrum-live"],
    spectrumSnap: t["--ui-chart-spectrum-snap"],
    spectrumLiveB: t["--ui-chart-spectrum-live-b"],
    spectrumSnapB: t["--ui-chart-spectrum-snap-b"],
  };
}
```

In `"defines distinct loudness history trace tokens for every theme"`, read trace colors from
`buildThemeTokens(BUILTIN_THEMES[themeId])` (keys `--ui-chart-momentary`, `--ui-chart-momentary-over`,
`--ui-chart-shortterm`, `--ui-chart-shortterm-over`) and the stroke widths/opacity from
`BUILTIN_THEMES[themeId].charts.loudnessHistory` (still present as geometry). Keep the same
assertions (over differs from live by ≥ 45, momentary differs from shortterm by ≥ 45, width ratio
≥ 1.75, opacity in (0,1]). In `"defines a distinct secondary spectrum color"`, read `--ui-chart-spectrum-live-b`
vs `--ui-chart-spectrum-live` from `buildThemeTokens`.

- [ ] **Step 4: Run theme tests**

Run: `npx vitest run src/theme`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(theme): drop derived color fields from theme data and delete bridge"
```

---

### Task 5: Full verification

- [ ] **Step 1: Confirm first-paint CSS still only depends on the dark semantic**

Run: `npm run theme:generate` then `git status --short`
Expected: no change to `src/generated/theme-fallbacks.css` (it is built from `PLVS_SEMANTIC_DARK`,
untouched this plan). If it changed, investigate.

- [ ] **Step 2: Run the full project check**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Manual smoke**

Launch the app. Confirm Dark and Light both render meters, loudness curves (M/ST distinct), vectorscope,
and spectrum with colors visually equivalent to before (slight shifts acceptable; light meter bars
intentionally now use light's signal colors). Toggle a loudness snapshot and confirm the snap/gold
family appears. No console errors.

- [ ] **Step 4: Commit any formatting auto-fixes**

```bash
git add -A
git commit -m "chore(theme): formatting after seed-derive refactor" || echo "nothing to commit"
```

---

## Self-Review

- **Spec coverage:** §4.1 seeds (`accent`/`accentSecondary`/`signal`) added (Task 2); §4.2 OKLCH
  scheme-aware transforms `snap`/`over`/`sibling` implemented (Tasks 1–2); §3 "no overrides" — colors
  derive purely from seeds + scheme, no per-token override map; `meterColorBridge.js` removed (Task 4).
  Correlation mid → `var(--muted-foreground)` per §4.1. Token **names unchanged** (rename is Plan 3).
- **Out of scope (correctly deferred):** token renames, dead-token *deletion* (Plan 3 — note this plan
  still writes the dead tokens so it changes only *how* values are produced, not *which* exist),
  geometry→global (Plan 3), spectrogram colormap (Plan 4), docs (Plan 5).
- **Approximate derivation:** closeness tests (≤ 30) per the user-confirmed decision; exact polish later.
- **Placeholder scan:** none — full code in every step; OKLCH deltas are concrete starting values with
  a test-driven tuning instruction (the test is the precise contract).
- **Type consistency:** `buildThemeTokens(theme)` returns `Record<string,string>` and is consumed by a
  single `Object.entries` loop in `applyThemeToDocument` (Task 3) and by tests (Tasks 2, 4) using the
  same `--ui-*` keys defined in Task 2. `transform`/`hexToOklch`/`oklchToHex` signatures defined in
  Task 1 match their use in Task 2.
