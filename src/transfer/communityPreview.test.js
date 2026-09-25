import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { buildPack } from "./packShape.js";
import { buildCommunityPreviewPlan } from "./communityPreview.js";
import { COMMUNITY_PREVIEW_FIXTURE_V2 } from "./fixtures/communityPreviewV2.js";

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
      contractVersion: 1,
      renderer: {
        name: "plvs-community-preview",
        version: 1,
        locale: "en-US",
        persistence: false,
        network: false,
        audioEngine: false,
        animations: false,
        clock: "fixture",
      },
      fixture: COMMUNITY_PREVIEW_FIXTURE_V2,
      fixtureHash: "sha256:dffe060b96531de3764592451706058c93ca6a88af80303196c2e2a17d58ead1",
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
