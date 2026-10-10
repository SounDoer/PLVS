import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { buildPack } from "./packShape.js";
import { buildCommunityPreviewPlan } from "./communityPreview.js";
import { COMMUNITY_PREVIEW_FIXTURE_V5 } from "./fixtures/communityPreviewV5.js";

const PROFILE = {
  id: "broadcast",
  name: "Broadcast",
  referenceLufs: -23,
  rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
};

describe("Community preview input contract", () => {
  it("pins the golden fixture and runtime for a Loudness Profile", async () => {
    const plan = await buildCommunityPreviewPlan(buildPack("loudness", [PROFILE]), "loudness");

    expect(plan).toMatchObject({
      contractVersion: 2,
      renderer: {
        name: "plvs-community-preview",
        version: 2,
        locale: "en-US",
        persistence: false,
        network: false,
        audioEngine: false,
        animations: false,
        clock: "fixture",
      },
      fixture: COMMUNITY_PREVIEW_FIXTURE_V5,
      fixtureHash: "sha256:acf4cba3aade577abc0b739566b637e31bd6494ef697583e81e62ccbab245362",
      item: {
        type: "loudness",
        contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        compatibility: { metricIds: ["truePeak"] },
      },
      dependencies: [],
    });
    expect(plan.assets.map(({ id }) => id)).toEqual(["profile-summary", "profile-stats-example"]);
    expect(plan.assets.every(({ source }) => source.fixtureHash === plan.fixtureHash)).toBe(true);
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
    const plan = await buildCommunityPreviewPlan(
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
    const plan = await buildCommunityPreviewPlan(buildPack("presets", [preset]), "presets");
    expect(plan.assets.map(({ id }) => id)).toEqual(["preset-workspace"]);
  });

  it("rejects desktop multi-item packs before producing preview inputs", async () => {
    await expect(
      buildCommunityPreviewPlan(
        buildPack("loudness", [PROFILE, { ...PROFILE, id: "other" }]),
        "loudness"
      )
    ).rejects.toThrow("exactly one primary Item");
  });
});
