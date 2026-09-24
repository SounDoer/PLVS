import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES_V2, getBuiltinThemeV2 } from "./builtinThemesV2.js";
import { compileTheme } from "./compileTheme.js";
import { V1_BUILTIN_RESOLVED } from "./fixtures/v1BuiltinResolved.js";
import { isCurrentThemeDocument } from "./themeSchema.js";

const REVIEWED_NON_EXACT = new Set(["--ui-loudness-grid", "--ui-vectorscope-grid-stroke"]);

// ADR 0005 keeps V1 appearance as pinned overrides until an explicit "adopt
// automatic colors" pass removes them. These bindings have been through that
// pass, so they no longer match V1. Record the derived value we accepted rather
// than skipping the binding, so unintended drift still fails here.
const ADOPTED_AUTOMATIC = {
  "plvs-dark": {
    "--primary": "#b35300",
    "--popover": "#1c1c1c",
    "--secondary": "#272727",
    "--muted": "#191919",
    "--accent": "#3b2410",
    "--muted-foreground": "#959595",
    "--primary-foreground": "#f2f2f2",
    "--destructive-foreground": "#f2f2f2",
    "--ring": "#b35300",
    "--destructive": "#b83238",
    "--ui-spectrum-secondary": "#209bda",
    "--ui-spectrum-secondary-snap": "#9cafff",
    "--ui-stereo-map-secondary": "#209bda",
    "--ui-stereo-map-secondary-snap": "#9cafff",
    "--ui-waveform-frequency-neutral": "#4c4c4c",
    "--ui-waveform-centroid": "#f2f2f2",
  },
  "plvs-light": {
    "--primary": "#c45f13",
    "--popover": "#eeeae7",
    "--secondary": "#e3dfdc",
    "--muted": "#f1ece9",
    "--accent": "#e9ceb9",
    "--muted-foreground": "#6a6461",
    "--destructive-foreground": "#140e0a",
    "--ring": "#c45f13",
    "--destructive": "#e43b46",
    "--ui-loudness-momentary": "#d16718",
    "--ui-loudness-shortterm": "#8f3400",
    "--ui-loudness-momentary-snap": "#8a4700",
    "--ui-loudness-shortterm-snap": "#511500",
    "--ui-loudness-selection": "#8a4700",
    "--ui-spectrum-primary": "#d16718",
    "--ui-spectrum-primary-snap": "#8a4700",
    "--ui-vectorscope-trace": "#d16718",
    "--ui-vectorscope-trace-snap": "#8a4700",
    "--ui-stereo-map-primary": "#d16718",
    "--ui-stereo-map-primary-snap": "#8a4700",
    "--ui-waveform-trace": "#d16718",
    "--ui-waveform-trace-snap": "#8a4700",
    "--ui-waveform-frequency-mid": "#c06f00",
    "--ui-waveform-frequency-neutral": "#aeacab",
    "--ui-waveform-centroid": "#140e0a",
    "--ui-meter-gradient-mid": "#9f6200",
  },
};

describe("Theme V2 builtins", () => {
  it.each(Object.keys(BUILTIN_THEMES_V2))("normalizes and compiles %s", (id) => {
    expect(isCurrentThemeDocument(BUILTIN_THEMES_V2[id])).toBe(true);
    expect(() => compileTheme(BUILTIN_THEMES_V2[id])).not.toThrow();
  });

  it.each(Object.keys(BUILTIN_THEMES_V2))(
    "preserves every untuned comparable V1 binding for %s",
    (id) => {
      const current = V1_BUILTIN_RESOLVED[id].css;
      const next = compileTheme(BUILTIN_THEMES_V2[id]).css;
      const adopted = ADOPTED_AUTOMATIC[id];
      for (const [binding, value] of Object.entries(next)) {
        if (binding in adopted) {
          expect(value, binding).toBe(adopted[binding]);
          continue;
        }
        if (!(binding in current) || REVIEWED_NON_EXACT.has(binding)) continue;
        expect(value, binding).toBe(current[binding]);
      }
    }
  );

  it.each(Object.keys(BUILTIN_THEMES_V2))("authors %s without a single override", (id) => {
    expect(BUILTIN_THEMES_V2[id].overrides).toEqual({});
  });

  it("is deeply immutable and falls back to Dark", () => {
    expect(Object.isFrozen(BUILTIN_THEMES_V2["plvs-dark"].core)).toBe(true);
    expect(getBuiltinThemeV2("missing")).toBe(BUILTIN_THEMES_V2["plvs-dark"]);
  });
});
