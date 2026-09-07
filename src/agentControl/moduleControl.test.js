import { describe, expect, it } from "vitest";
import { MODULE_CATALOG } from "../workspace/moduleCatalog.js";
import {
  buildModuleDescription,
  buildModuleDescriptionContext,
  buildModuleList,
} from "./moduleControl.js";

describe("Module Control", () => {
  it("lists every module in catalog order without UI implementation details", () => {
    expect(buildModuleList()).toEqual(
      Object.values(MODULE_CATALOG).map((module) => ({
        moduleId: module.id,
        title: module.title,
      }))
    );
  });

  it("describes creation-time defaults, schema, axes, and hard layout limits", () => {
    expect(buildModuleDescription("spectrum", { channelCount: 6 })).toMatchObject({
      moduleId: "spectrum",
      title: "Spectrum",
      layout: {
        hardMinimumWidth: 32,
        hardMinimumHeight: 36,
        unit: "logicalPx",
      },
      axisKinds: ["frequency"],
      defaultControls: {
        channel: { type: "pair", x: 0, y: 1 },
      },
      controlsSchema: {
        type: "object",
      },
    });
  });

  it("returns null for an unknown module", () => {
    expect(buildModuleDescription("unknown")).toBeNull();
  });

  it("makes the runtime basis of a description explicit", () => {
    expect(buildModuleDescriptionContext({ channelCount: 8 }, true)).toEqual({
      channelTopology: { status: "detected", channelCount: 8 },
      hasLoudnessReference: true,
    });
    expect(buildModuleDescriptionContext()).toEqual({
      channelTopology: { status: "assumed", channelCount: 2 },
      hasLoudnessReference: false,
    });
  });
});
