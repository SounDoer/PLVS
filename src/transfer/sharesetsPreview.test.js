import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { buildPack } from "./packShape.js";
import { buildSharesetsPreviewPlan } from "./sharesetsPreview.js";
import { SHARESETS_PREVIEW_FIXTURE_V5 } from "./fixtures/sharesetsPreviewV5.js";
import { SHARESETS_PREVIEW_MULTICHANNEL_V1 } from "./fixtures/sharesetsPreviewMultichannelV1.js";
import { MULTICHANNEL_MONITORING_PRESET } from "../sharesets-preview/multichannelMonitoringPreset.js";

const PROFILE = {
  id: "broadcast",
  name: "Broadcast",
  referenceLufs: -23,
  rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
};

describe("Sharesets preview input contract", () => {
  it("pins the golden fixture and runtime for a Loudness Profile", async () => {
    const plan = await buildSharesetsPreviewPlan(buildPack("loudness", [PROFILE]), "loudness");

    expect(plan).toMatchObject({
      contractVersion: 4,
      renderer: {
        name: "plvs-sharesets-preview",
        version: 2,
        locale: "en-US",
        persistence: false,
        network: false,
        audioEngine: false,
        animations: false,
        clock: "fixture",
      },
      fixture: SHARESETS_PREVIEW_FIXTURE_V5,
      fixtureHash: "sha256:31fbbaa214f2fb49e23480b7967c2c24f588227f67641ca2976693e87892cf69",
      item: {
        type: "loudness",
        contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        compatibility: { metricIds: ["truePeak"] },
      },
      dependencies: [],
    });
    expect(plan.assets).toEqual([]);
  });

  it("renders a Preset workspace plus its optional Dock with the same fixture", async () => {
    const preset = {
      id: "mix",
      name: "Mix",
      ...structuredClone(DEFAULT_WORKSPACE_STATE),
      dock: {
        enabled: true,
        edge: "bottom",
        reserveSpace: false,
        height: 80,
        panelsById: {},
        panelOrder: [],
        panelSizesById: {},
        controlsByPanelId: {},
      },
      loudnessProfileActive: "profile:broadcast",
    };
    const plan = await buildSharesetsPreviewPlan(
      buildPack("presets", [preset], { loudnessProfiles: [PROFILE] }),
      "presets"
    );

    expect(plan.item).toMatchObject({
      type: "presets",
      compatibility: {
        dependencyIds: ["broadcast"],
        optionalCapabilities: ["dock"],
      },
    });
    expect(plan.dependencies).toEqual([
      expect.objectContaining({
        id: "broadcast",
        contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        document: expect.objectContaining({
          kind: "plvs-loudness-profile",
          name: "Broadcast",
        }),
      }),
    ]);
    expect(plan.assets.map(({ id }) => id)).toEqual(["preset-workspace", "preset-dock"]);
  });

  it("omits the Dock surface when the portable Preset disables Dock", async () => {
    const preset = {
      id: "mix",
      name: "Mix",
      ...structuredClone(DEFAULT_WORKSPACE_STATE),
      dock: { enabled: false },
      loudnessProfileActive: "off",
    };
    const plan = await buildSharesetsPreviewPlan(buildPack("presets", [preset]), "presets");
    expect(plan.assets.map(({ id }) => id)).toEqual(["preset-workspace"]);
  });

  it("renders the official Multichannel Monitoring Preset with the 5.1 fixture at 1280×800", async () => {
    const pack = {
      app: "PLVS",
      kind: "preset-pack",
      version: 2,
      items: [{ id: "multichannel-monitoring", ...MULTICHANNEL_MONITORING_PRESET }],
      dependencies: [],
    };
    const plan = await buildSharesetsPreviewPlan(pack, "presets");

    expect(plan.fixture).toEqual(SHARESETS_PREVIEW_MULTICHANNEL_V1);
    expect(plan.assets).toEqual([
      expect.objectContaining({
        id: "preset-workspace",
        renderer: "multichannel-monitoring",
        viewport: { widthCssPx: 1280, heightCssPx: 800, deviceScaleFactor: 1 },
      }),
    ]);
  });

  it("rejects desktop multi-item packs before producing preview inputs", async () => {
    await expect(
      buildSharesetsPreviewPlan(
        buildPack("loudness", [PROFILE, { ...PROFILE, id: "other" }]),
        "loudness"
      )
    ).rejects.toThrow("exactly one primary Item");
  });
});
