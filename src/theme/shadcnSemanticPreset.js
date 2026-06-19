/**
 * Semantic color tokens aligned with the shadcn/ui **default (neutral)** preset from
 * https://ui.shadcn.com/docs/theming (oklch values as published there).
 *
 * `--radius` matches the same preset. Product accent (`primary` / `ring`) overrides neutral
 * primaries so metering CTAs stay cyan-readable on both modes.
 *
 * First-paint `:root` tokens are generated from the builtin dark semantic via `buildThemeFallbackCss`
 * (`npm run theme:generate` → `src/generated/theme-fallbacks.css`, imported by `index.css`).
 */

/** @typedef {Record<string, string>} ShadcnSemantic */

/** shadcn docs — `:root` neutral (light) */
export const SHADCN_NEUTRAL_SEMANTIC_LIGHT = {
  background: "oklch(1 0 0)",
  foreground: "oklch(0.145 0 0)",
  card: "oklch(1 0 0)",
  cardForeground: "oklch(0.145 0 0)",
  popover: "oklch(1 0 0)",
  popoverForeground: "oklch(0.145 0 0)",
  primary: "oklch(0.205 0 0)",
  primaryForeground: "oklch(0.985 0 0)",
  secondary: "oklch(0.97 0 0)",
  secondaryForeground: "oklch(0.205 0 0)",
  muted: "oklch(0.97 0 0)",
  mutedForeground: "oklch(0.556 0 0)",
  accent: "oklch(0.97 0 0)",
  accentForeground: "oklch(0.205 0 0)",
  destructive: "oklch(0.577 0.245 27.325)",
  destructiveForeground: "oklch(0.985 0 0)",
  border: "oklch(0.922 0 0)",
  input: "oklch(0.922 0 0)",
  ring: "oklch(0.708 0 0)",
  chart1: "oklch(0.646 0.222 41.116)",
  chart2: "oklch(0.6 0.118 184.704)",
  chart3: "oklch(0.398 0.07 227.392)",
  chart4: "oklch(0.828 0.189 84.429)",
  chart5: "oklch(0.769 0.188 70.08)",
};

/** shadcn docs — dark neutral (reference baseline for PLVS themes). */
export const SHADCN_NEUTRAL_SEMANTIC_DARK = {
  background: "oklch(0.145 0 0)",
  foreground: "oklch(0.985 0 0)",
  card: "oklch(0.205 0 0)",
  cardForeground: "oklch(0.985 0 0)",
  popover: "oklch(0.205 0 0)",
  popoverForeground: "oklch(0.985 0 0)",
  primary: "oklch(0.922 0 0)",
  primaryForeground: "oklch(0.205 0 0)",
  secondary: "oklch(0.269 0 0)",
  secondaryForeground: "oklch(0.985 0 0)",
  muted: "oklch(0.269 0 0)",
  mutedForeground: "oklch(0.708 0 0)",
  accent: "oklch(0.269 0 0)",
  accentForeground: "oklch(0.985 0 0)",
  destructive: "oklch(0.704 0.191 22.216)",
  destructiveForeground: "oklch(0.985 0 0)",
  border: "oklch(1 0 0 / 10%)",
  input: "oklch(1 0 0 / 15%)",
  ring: "oklch(0.556 0 0)",
  chart1: "oklch(0.488 0.243 264.376)",
  chart2: "oklch(0.696 0.17 162.48)",
  chart3: "oklch(0.769 0.188 70.08)",
  chart4: "oklch(0.627 0.265 303.9)",
  chart5: "oklch(0.645 0.246 16.439)",
};

/** PLVS Light — warm cream shell + orange brand. Mirrors PLVS Dark's warmth on a light surface. */
export const PLVS_SEMANTIC_LIGHT = {
  background: "oklch(0.98 0.005 70)",
  foreground: "oklch(0.17 0.012 55)",
  card: "oklch(0.96 0.006 60)",
  cardForeground: "oklch(0.17 0.012 55)",
  popover: "oklch(0.96 0.006 60)",
  popoverForeground: "oklch(0.17 0.012 55)",
  primary: "#fb923c",
  primaryForeground: "oklch(0.17 0.012 55)",
  secondary: "oklch(0.91 0.008 60)",
  secondaryForeground: "oklch(0.17 0.012 55)",
  muted: "oklch(0.91 0.008 60)",
  mutedForeground: "oklch(0.50 0.015 55)",
  accent: "oklch(0.91 0.008 60)",
  accentForeground: "oklch(0.17 0.012 55)",
  destructive: "oklch(0.58 0.22 25)",
  destructiveForeground: "oklch(0.985 0 0)",
  border: "oklch(0 0 0 / 10%)",
  input: "oklch(0 0 0 / 14%)",
  ring: "#fb923c",
  chart1: "oklch(0.646 0.222 41.116)",
  chart2: "oklch(0.6 0.118 184.704)",
  chart3: "oklch(0.398 0.07 227.392)",
  chart4: "oklch(0.828 0.189 84.429)",
  chart5: "oklch(0.769 0.188 70.08)",
};

/** PLVS Dark — neutral gray shell + orange brand. */
export const PLVS_SEMANTIC_DARK = {
  background: "oklch(0.13 0 0)",
  foreground: "oklch(0.96 0 0)",
  card: "oklch(0.195 0 0)",
  cardForeground: "oklch(0.96 0 0)",
  popover: "oklch(0.195 0 0)",
  popoverForeground: "oklch(0.96 0 0)",
  primary: "#fb923c",
  primaryForeground: "oklch(0.13 0 0)",
  secondary: "oklch(0.258 0 0)",
  secondaryForeground: "oklch(0.96 0 0)",
  muted: "oklch(0.258 0 0)",
  mutedForeground: "oklch(0.63 0 0)",
  accent: "oklch(0.258 0 0)",
  accentForeground: "oklch(0.96 0 0)",
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

/** shadcn semantic keys → CSS custom property names (single source for runtime + generated first paint). */
export const SHADCN_SEMANTIC_CSS_VAR_BINDINGS = [
  ["--background", "background"],
  ["--foreground", "foreground"],
  ["--card", "card"],
  ["--card-foreground", "cardForeground"],
  ["--popover", "popover"],
  ["--popover-foreground", "popoverForeground"],
  ["--primary", "primary"],
  ["--primary-foreground", "primaryForeground"],
  ["--secondary", "secondary"],
  ["--secondary-foreground", "secondaryForeground"],
  ["--muted", "muted"],
  ["--muted-foreground", "mutedForeground"],
  ["--accent", "accent"],
  ["--accent-foreground", "accentForeground"],
  ["--destructive", "destructive"],
  ["--destructive-foreground", "destructiveForeground"],
  ["--border", "border"],
  ["--input", "input"],
  ["--ring", "ring"],
  ["--chart-1", "chart1"],
  ["--chart-2", "chart2"],
  ["--chart-3", "chart3"],
  ["--chart-4", "chart4"],
  ["--chart-5", "chart5"],
];

/**
 * Converts an oklch() CSS value string to a hex or rgba fallback string.
 * Handles `oklch(L C H)` and `oklch(L C H / alpha%)`.
 * @param {string} value
 * @returns {string} e.g. `#1a1a1a` or `rgba(255, 255, 255, 0.1)`
 */
export function oklchToHex(value) {
  const m = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i);
  if (!m) return value;

  const L = parseFloat(m[1]);
  const C = parseFloat(m[2]);
  const H = parseFloat(m[3]);
  const alpha =
    m[4] != null ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : null;

  // OKLCH → OKLab
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // OKLab → LMS (before cube)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  // Cube to get linear LMS
  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  // Linear LMS → linear sRGB
  const rLin = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  // Linear sRGB → gamma-corrected sRGB
  const toGamma = (c) => {
    const clamped = Math.max(0, Math.min(1, c));
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  };

  const r = Math.round(toGamma(rLin) * 255);
  const g = Math.round(toGamma(gLin) * 255);
  const b2 = Math.round(toGamma(bLin) * 255);

  if (alpha != null) {
    const a2 = Math.round(alpha * 1000) / 1000;
    return `rgba(${r}, ${g}, ${b2}, ${a2})`;
  }
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b2.toString(16).padStart(2, "0")}`;
}

/**
 * CSS text for `:root` first paint (matches `applyShadcnSemanticTokensToDocument` mapping).
 * Uses the builtin **`plvs-dark`** semantic only (ADR 0002).
 * @param {ShadcnSemantic} semanticDark
 * @param {string} radiusCss e.g. `0.625rem` — keep aligned with `UI_PREFERENCES.radii.card`
 */
export function buildThemeFallbackCss(semanticDark, radiusCss) {
  const header = [
    "/* AUTO-GENERATED — run `npm run theme:generate` after editing PLVS_SEMANTIC_* */",
    "/* First-paint shadcn semantic tokens (plvs-dark); runtime re-applied by applyThemeToDocument */",
    "",
  ].join("\n");

  const baseLines = [":root {", `  --radius: ${radiusCss};`];
  const supportsLines = [];

  for (const [cssName, key] of SHADCN_SEMANTIC_CSS_VAR_BINDINGS) {
    const val = semanticDark[key];
    if (val && val.trim().startsWith("oklch(")) {
      baseLines.push(`  ${cssName}: ${oklchToHex(val)};`);
      supportsLines.push(`  ${cssName}: ${val};`);
    } else {
      baseLines.push(`  ${cssName}: ${val};`);
    }
  }
  baseLines.push("}");

  const parts = [header, baseLines.join("\n")];
  if (supportsLines.length > 0) {
    const indented = supportsLines.map((l) => "  " + l);
    parts.push(
      "",
      "@supports (color: oklch(0 0 0)) {",
      "  :root {",
      indented.join("\n"),
      "  }",
      "}"
    );
  }
  return parts.join("\n") + "\n";
}

/**
 * Returns value with oklch converted to hex/rgba when the engine lacks oklch support.
 * Safe to call in non-browser environments (returns value unchanged).
 * @param {string | undefined | null} value
 * @returns {string | undefined | null}
 */
export function oklchSafe(value) {
  if (
    typeof value !== "string" ||
    !value.trim().startsWith("oklch(") ||
    (typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("color", "oklch(0 0 0)"))
  ) {
    return value;
  }
  return oklchToHex(value);
}

function setCssVar(name, value) {
  if (value === undefined || value === null) return;
  document.documentElement.style.setProperty(name, String(value));
}

/**
 * Writes shadcn semantic CSS variables on `document.documentElement`.
 * @param {ShadcnSemantic} semantic
 */
export function applyShadcnSemanticTokensToDocument(semantic) {
  if (typeof document === "undefined") return;
  for (const [cssName, key] of SHADCN_SEMANTIC_CSS_VAR_BINDINGS) {
    setCssVar(cssName, oklchSafe(semantic[key]));
  }
}
