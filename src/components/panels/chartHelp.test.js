import { describe, expect, it } from "vitest";

import {
  PANEL_HELP_BY_MODULE_ID,
  SPECTROGRAM_2D_HELP,
  SPECTROGRAM_3D_HELP,
  resolvePanelHelpItems,
} from "./chartHelp.js";

function itemsOf(sections) {
  return sections.flatMap((section) => section.items);
}

describe("spectrogram panel help", () => {
  it("resolves gestures from the active view mode", () => {
    expect(resolvePanelHelpItems("spectrogram", { spectrogram3d: true })).toBe(SPECTROGRAM_3D_HELP);
    expect(resolvePanelHelpItems("spectrogram", { spectrogram3d: false })).toBe(
      SPECTROGRAM_2D_HELP
    );
    // Absent is 2D: panelControls reaches here unnormalised, so a panel that never touched the
    // toggle must not be told about a mode it is not in.
    expect(resolvePanelHelpItems("spectrogram", {})).toBe(SPECTROGRAM_2D_HELP);
    expect(resolvePanelHelpItems("spectrogram", undefined)).toBe(SPECTROGRAM_2D_HELP);
  });

  it("never lists both meanings of the right button at once", () => {
    // The whole reason this help is mode-resolved. The right button pans and resets the timeline in
    // 2D and rotates and resets the viewpoint in 3D, so showing both leaves one of them wrong.
    const twoD = itemsOf(SPECTROGRAM_2D_HELP);
    const threeD = itemsOf(SPECTROGRAM_3D_HELP);

    expect(twoD).toContain("Right drag - Pan timeline");
    expect(twoD.some((item) => item.includes("Rotate"))).toBe(false);

    expect(threeD).toContain("Right drag - Rotate the surface");
    expect(threeD.some((item) => item.includes("Pan timeline"))).toBe(false);
  });

  it("mentions Shift+wheel and the tick caveat only in 3D", () => {
    const twoD = itemsOf(SPECTROGRAM_2D_HELP);
    const threeD = itemsOf(SPECTROGRAM_3D_HELP);

    expect(threeD.some((item) => item.startsWith("Shift + wheel"))).toBe(true);
    expect(twoD.some((item) => item.startsWith("Shift + wheel"))).toBe(false);

    // In 2D the ticks do line up with the data, so the caveat would be a lie there.
    expect(threeD.some((item) => item.includes("state the range, not a position"))).toBe(true);
    expect(twoD.some((item) => item.includes("state the range"))).toBe(false);
  });
});

describe("vectorscope panel help", () => {
  it("resolves gestures from the active vectorscope mode", () => {
    const resolveHelp = PANEL_HELP_BY_MODULE_ID.vectorscope;

    expect(typeof resolveHelp).toBe("function");
    expect(resolveHelp({ vectorscopeMode: "lissajous" })[0].items).toEqual([
      "Left hold - Slow trace decay",
    ]);
    expect(resolveHelp({ vectorscopeMode: "polarSample" })).toBeNull();
    expect(
      resolveHelp({
        vectorscopeMode: "polarLevel",
        vectorscopePolarLevelMaxHold: true,
      })[0].items
    ).toEqual(["Click plot - Reset Max hold"]);
    expect(
      resolveHelp({
        vectorscopeMode: "polarLevel",
        vectorscopePolarLevelMaxHold: false,
      })
    ).toBeNull();
  });
});
