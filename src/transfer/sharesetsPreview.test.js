import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { buildPack } from "./packShape.js";
import { buildSharesetsPreviewPlan } from "./sharesetsPreview.js";
import { SHARESETS_PREVIEW_STEREO_V1 } from "./fixtures/sharesetsPreviewStereoV1.js";
import { SHARESETS_PREVIEW_MULTICHANNEL_V1 } from "./fixtures/sharesetsPreviewMultichannelV1.js";
import { SHARESETS_PREVIEW_DIALOGUE_STEREO_V1 } from "./fixtures/sharesetsPreviewDialogueStereoV1.js";
import { SHARESETS_PREVIEW_DIALOGUE_MULTICHANNEL_V1 } from "./fixtures/sharesetsPreviewDialogueMultichannelV1.js";
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
      contractVersion: 1,
      renderer: {
        name: "plvs-sharesets-preview",
        version: 1,
        locale: "en-US",
        persistence: false,
        network: false,
        audioEngine: false,
        animations: false,
        clock: "fixture",
      },
      fixture: SHARESETS_PREVIEW_STEREO_V1,
      fixtureHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
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

  it("declares explicit Stereo and 5.1 workspace variants for Meter Bridge", async () => {
    const preset = {
      id: "meter-bridge",
      name: "Meter Bridge",
      ...structuredClone(DEFAULT_WORKSPACE_STATE),
      dock: { enabled: false },
      loudnessProfileActive: "off",
    };
    const plan = await buildSharesetsPreviewPlan(buildPack("presets", [preset]), "presets");

    expect(plan.contractVersion).toBe(1);
    expect(plan.fixture).toEqual(SHARESETS_PREVIEW_STEREO_V1);
    expect(plan.multichannelFixture).toEqual(SHARESETS_PREVIEW_MULTICHANNEL_V1);
    expect(plan.assets).toEqual([
      expect.objectContaining({
        id: "preset-workspace-stereo",
        fixtureKey: "stereo",
        source: expect.objectContaining({ fixtureHash: plan.fixtureHash }),
      }),
      expect.objectContaining({
        id: "preset-workspace-5-1",
        fixtureKey: "5.1",
        source: expect.objectContaining({
          fixtureHash: "sha256:24114965b400c5e8e9251e58fe57b962dae0247fdd10b1f55571f972851fcc6d",
        }),
      }),
    ]);
  });

  it("uses measured Dialogue fixtures for Dialogue Delivery Review", async () => {
    const preset = {
      id: "dialogue-delivery-review",
      name: "Dialogue Delivery Review",
      ...structuredClone(DEFAULT_WORKSPACE_STATE),
      dock: { enabled: false },
      loudnessProfileActive: "off",
    };
    const plan = await buildSharesetsPreviewPlan(buildPack("presets", [preset]), "presets");

    expect(plan.contractVersion).toBe(1);
    expect(plan.fixture).toEqual(SHARESETS_PREVIEW_DIALOGUE_STEREO_V1);
    expect(plan.multichannelFixture).toEqual(SHARESETS_PREVIEW_DIALOGUE_MULTICHANNEL_V1);
    expect(plan.assets.map(({ id }) => id)).toEqual([
      "preset-workspace-stereo",
      "preset-workspace-5-1",
    ]);
    expect(plan.assets[0].source.fixtureHash).not.toBe(plan.assets[1].source.fixtureHash);
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
