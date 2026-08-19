import { BUILTIN_THEMES } from "../builtinThemes.js";
import { compileTheme } from "../compileTheme.js";
import { SHADCN_SEMANTIC_CSS_VAR_BINDINGS } from "../shadcnSemanticPreset.js";

function hexChannels(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Temporary compatibility view for the V1 runtime/editor. Remove when Phase 4/6 consumers move. */
export function projectV2ThemeToV1(theme) {
  const resolved = compileTheme(theme);
  const builtin =
    theme.colorScheme === "light" ? BUILTIN_THEMES["plvs-light"] : BUILTIN_THEMES["plvs-dark"];
  const semantic = { ...builtin.semantic };
  for (const [binding, key] of SHADCN_SEMANTIC_CSS_VAR_BINDINGS) {
    if (resolved.css[binding]) semantic[key] = resolved.css[binding];
  }
  return {
    id: theme.id,
    name: theme.name,
    colorScheme: theme.colorScheme,
    seeds: {
      accent: theme.core.interfaceAccent,
      accentSecondary: theme.core.secondaryData,
      signal: {
        good: theme.palettes.status.good,
        warn: theme.palettes.status.warning,
        bad: theme.palettes.status.critical,
      },
    },
    semantic,
    colormap: theme.palettes.intensity.stops.map((stop) => [
      Math.round(stop.position * 255),
      hexChannels(stop.color),
    ]),
  };
}
