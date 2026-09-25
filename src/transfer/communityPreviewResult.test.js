import { describe, expect, it } from "vitest";
import { buildCommunityPreviewPlan } from "./communityPreview.js";
import {
  COMMUNITY_PREVIEW_RESULT_VERSION,
  validateCommunityPreviewResult,
} from "./communityPreviewResult.js";
import { buildPack } from "./packShape.js";

const PROFILE = {
  id: "profile",
  name: "I −23 ±0.5 · TP ≤ −1",
  referenceLufs: -23,
  rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
};

async function fixture() {
  const plan = await buildCommunityPreviewPlan(buildPack("loudness", [PROFILE]), "loudness");
  const result = {
    resultVersion: COMMUNITY_PREVIEW_RESULT_VERSION,
    renderer: { name: plan.renderer.name, version: plan.renderer.version },
    contentHash: plan.item.contentHash,
    fixtureHash: plan.fixtureHash,
    assets: plan.assets.map((asset, index) => ({
      id: asset.id,
      path: `${asset.id}.png`,
      mediaType: "image/png",
      width: asset.viewport.widthCssPx,
      height: asset.viewport.heightCssPx,
      byteLength: 100 + index,
      sha256: `sha256:${index.toString(16).padStart(64, "0")}`,
      source: asset.source,
    })),
  };
  return { plan, result };
}

describe("Community preview result", () => {
  it("normalizes the exact ordered asset set and immutable render identity", async () => {
    const { plan, result } = await fixture();
    expect(
      validateCommunityPreviewResult(plan, { ...result, assets: [...result.assets].reverse() })
    ).toMatchObject({
      resultVersion: 1,
      renderer: { name: "plvs-community-preview", version: 1 },
      contentHash: plan.item.contentHash,
      fixtureHash: plan.fixtureHash,
    });
    expect(validateCommunityPreviewResult(plan, result).assets.map(({ id }) => id)).toEqual(
      plan.assets.map(({ id }) => id)
    );
  });

  it("rejects missing, extra, mis-sized, misnamed, or untrusted assets", async () => {
    const { plan, result } = await fixture();
    const malformed = structuredClone(result);
    malformed.assets[0].path = "publisher-cover.png";
    malformed.assets[0].width += 1;
    malformed.assets[0].source = { ...malformed.assets[0].source, generator: "publisher" };
    malformed.assets.pop();
    malformed.assets.push({ ...result.assets[0], id: "promo" });

    expect(() => validateCommunityPreviewResult(plan, malformed)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "invalidPreviewAssetPath" }),
          expect.objectContaining({ code: "invalidPreviewWidth" }),
          expect.objectContaining({ code: "previewSourceMismatch" }),
          expect.objectContaining({ code: "missingPreviewAsset" }),
          expect.objectContaining({ code: "unexpectedPreviewAsset" }),
        ]),
      })
    );
  });
});
