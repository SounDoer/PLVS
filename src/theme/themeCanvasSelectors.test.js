import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import { compileTheme } from "./compileTheme.js";
import { selectStereoMapCanvasColors, selectWaveformCanvasColors } from "./themeCanvasSelectors.js";

describe("Theme Canvas selectors", () => {
  it("publishes Waveform Grid and Selection as independent module colors", () => {
    const resolved = compileTheme(BUILTIN_THEMES_V2["plvs-dark"]);
    const colors = selectWaveformCanvasColors(resolved);

    expect(colors.grid).toBe(resolved.roles["waveform.grid"]);
    expect(colors.selection).toBe(resolved.roles["waveform.selection"]);
  });

  it("publishes Stereo Map status ranges through module-local roles", () => {
    const resolved = compileTheme(BUILTIN_THEMES_V2["plvs-dark"]);
    const colors = selectStereoMapCanvasColors(resolved);

    expect(colors.good).toBe(resolved.roles["stereoMap.safeRange"]);
    expect(colors.warning).toBe(resolved.roles["stereoMap.warningRange"]);
    expect(colors.critical).toBe(resolved.roles["stereoMap.criticalRange"]);
  });
});
