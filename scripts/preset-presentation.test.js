import { describe, expect, it } from "vitest";
import { settingRows, presetPanels, presetExtraDetails } from "./preset-presentation.mjs";
const pack = (enabled = false) => ({
  items: [
    {
      workspace: {
        panels: [
          {
            moduleId: "spectrum",
            title: "<Left>",
            controls: { channel: { type: "single", ch: 0 } },
            axes: {},
          },
          { moduleId: "spectrum", controls: { channel: { type: "pair", x: 2, y: 3 } }, axes: {} },
        ],
      },
      presentation: { alwaysOnTop: false, panelOpacityPercent: 90 },
      dock: {
        enabled,
        edge: "bottom",
        heightCssPx: 72,
        panels: [{ moduleId: "stats", controls: {} }],
      },
      loudnessProfile: { dependencyId: null },
    },
  ],
  dependencies: [],
});
describe("Preset presentation", () => {
  it("formats channels and nested units without exposing zero-based indices", () => {
    const html = settingRows({
      channel: { type: "single", ch: 0 },
      levelRangeDbfs: { min: -60, max: 3 },
      speedPercent: 25,
      axes: { time: { windowSec: 60 } },
      peakThresholdsDbfs: { warning: -6 },
      persistenceMs: 200,
    });
    for (const text of ["Channel 1", "−60 to 3 dBFS", "25%", "60 s", "−6 dBFS", "200 ms"])
      expect(html).toContain(text);
  });
  it("keeps duplicate module instances, escapes titles, and omits disabled Dock content", () => {
    const html = presetPanels(pack());
    expect(html.match(/<details /g)).toHaveLength(2);
    expect(html).toContain("&lt;Left&gt;");
    expect(html).not.toContain("Workspace 2");
    expect(html).toContain("Channels 3 / 4");
    expect(html).not.toContain("Dock 1");
    expect(presetPanels(pack(true))).toContain("<span>Dock</span>");
    const duplicate = pack();
    delete duplicate.items[0].workspace.panels[0].title;
    expect(presetPanels(duplicate)).toContain("<summary>Spectrum 1</summary>");
    expect(presetPanels(duplicate)).toContain("<summary>Spectrum 2</summary>");
    expect(presetExtraDetails(pack())).toContain("<dt>Loudness Profile</dt><dd>Off</dd>");
    expect(presetExtraDetails(pack())).not.toContain("72 px");
    expect(presetExtraDetails(pack(true))).toContain("72 px");
  });
  it("renders all rules from the referenced bundled profile", () => {
    const input = pack();
    input.items[0].loudnessProfile.dependencyId = "target";
    input.dependencies = [
      {
        items: [
          { id: "other", name: "Other", rules: [] },
          {
            id: "target",
            name: "Target",
            referenceLufs: -23,
            rules: Array.from({ length: 5 }, (_, i) => ({
              metricId: "truePeak",
              op: ">",
              value: -i,
              severity: "warn",
            })),
          },
        ],
      },
    ];
    const html = presetPanels(input);
    expect(html).toContain("Included Loudness Profile");
    expect(html.match(/profile-rule-severity-warn/g)).toHaveLength(5);
    expect(html).not.toContain("Other");
    expect(presetExtraDetails(input)).toContain("<dd>Target</dd>");
  });
});
