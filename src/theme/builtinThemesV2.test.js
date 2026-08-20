import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES_V2, getBuiltinThemeV2 } from "./builtinThemesV2.js";
import { compileTheme } from "./compileTheme.js";
import { V1_BUILTIN_RESOLVED } from "./fixtures/v1BuiltinResolved.js";
import { isThemeV2 } from "./themeSchema.js";

const REVIEWED_NON_EXACT = new Set(["--ui-loudness-grid", "--ui-vectorscope-grid-stroke"]);

// ADR 0005 keeps V1 appearance as pinned overrides until an explicit "adopt
// automatic colors" pass removes them. These bindings have been through that
// pass, so they no longer match V1. Record the derived value we accepted rather
// than skipping the binding, so unintended drift still fails here.
const ADOPTED_AUTOMATIC = {
  "plvs-dark": {
    "--popover": "#141414",
    "--secondary": "#242424",
    "--muted": "#242424",
    "--accent": "#31241a",
    "--muted-foreground": "#959595",
    "--primary-foreground": "#f2f2f2",
    "--destructive-foreground": "#f2f2f2",
    "--ui-waveform-frequency-neutral": "#4c4c4c",
    "--ui-waveform-centroid": "#f2f2f2",
  },
  "plvs-light": {
    "--popover": "#f5f2ef",
    "--secondary": "#e5e1de",
    "--muted": "#e5e1de",
    "--accent": "#f2e2d5",
    "--muted-foreground": "#736d6a",
    "--destructive-foreground": "#140e0a",
    "--ui-waveform-frequency-neutral": "#a9a7a6",
    "--ui-waveform-centroid": "#140e0a",
  },
};

describe("Theme V2 builtins", () => {
  it.each(Object.keys(BUILTIN_THEMES_V2))("normalizes and compiles %s", (id) => {
    expect(isThemeV2(BUILTIN_THEMES_V2[id])).toBe(true);
    expect(() => compileTheme(BUILTIN_THEMES_V2[id])).not.toThrow();
  });

  it.each(Object.keys(BUILTIN_THEMES_V2))(
    "preserves every comparable opaque V1 binding for %s",
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
