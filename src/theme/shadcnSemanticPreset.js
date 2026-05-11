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

/** shadcn docs — dark neutral (reference; AudioMeter ships `AUDIOMETER_SEMANTIC_*`). */
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

/** Light preset + sky accent (readable on white cards). */
export const AUDIOMETER_SEMANTIC_LIGHT = {
  ...SHADCN_NEUTRAL_SEMANTIC_LIGHT,
  primary: "oklch(0.58 0.15 245)",
  primaryForeground: "oklch(0.985 0 0)",
  ring: "oklch(0.58 0.15 245)",
};

/** Dark preset + cyan accent (matches legacy AudioMeter chrome). */
export const AUDIOMETER_SEMANTIC_DARK = {
  ...SHADCN_NEUTRAL_SEMANTIC_DARK,
  primary: "#22d3ee",
  primaryForeground: "oklch(0.145 0 0)",
  ring: "#22d3ee",
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
 * CSS text for `:root` first paint (matches `applyShadcnSemanticTokensToDocument` mapping).
 * Uses the builtin **`audiometer-dark`** semantic only (ADR 0002).
 * @param {ShadcnSemantic} semanticDark
 * @param {string} radiusCss e.g. `0.625rem` — keep aligned with `UI_PREFERENCES.radii.card`
 */
export function buildThemeFallbackCss(semanticDark, radiusCss) {
  const header = [
    "/* AUTO-GENERATED — run `npm run theme:generate` after editing AUDIOMETER_SEMANTIC_* */",
    "/* First-paint shadcn semantic tokens (audiometer-dark); runtime re-applied by applyThemeToDocument */",
    "",
  ].join("\n");

  const lines = [":root {", `  --radius: ${radiusCss};`];
  for (const [cssName, key] of SHADCN_SEMANTIC_CSS_VAR_BINDINGS) {
    lines.push(`  ${cssName}: ${semanticDark[key]};`);
  }
  lines.push("}");
  return `${header}${lines.join("\n")}\n`;
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
    setCssVar(cssName, semantic[key]);
  }
}
