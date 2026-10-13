import { describe, expect, it } from "vitest";
import { buildSharesetsPreviewPlan } from "./sharesetsPreview.js";
import {
  SHARESETS_PREVIEW_RESULT_VERSION,
  validateSharesetsPreviewResult,
} from "./sharesetsPreviewResult.js";
import { buildPack } from "./packShape.js";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";

const PROFILE = {
  id: "profile",
  name: "I −23 ±0.5 · TP ≤ −1",
  referenceLufs: -23,
  rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
};
const PRESET = {
  id: "workspace",
  name: "Workspace",
  ...structuredClone(DEFAULT_WORKSPACE_STATE),
  dock: { enabled: false },
  loudnessProfileActive: "off",
};

async function fixture(type = "presets") {
  const item = type === "loudness" ? PROFILE : PRESET;
  const plan = await buildSharesetsPreviewPlan(buildPack(type, [item]), type);
  const result = {
    resultVersion: SHARESETS_PREVIEW_RESULT_VERSION,
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

describe("Sharesets preview result", () => {
  it("accepts the empty generated asset set for a Loudness Profile", async () => {
    const { plan, result } = await fixture("loudness");

    expect(validateSharesetsPreviewResult(plan, result).assets).toEqual([]);
  });

  it("normalizes the exact ordered asset set and immutable render identity", async () => {
    const { plan, result } = await fixture();
    expect(
      validateSharesetsPreviewResult(plan, { ...result, assets: [...result.assets].reverse() })
    ).toMatchObject({
      resultVersion: 1,
      renderer: { name: "plvs-sharesets-preview", version: 1 },
      contentHash: plan.item.contentHash,
      fixtureHash: plan.fixtureHash,
    });
    expect(validateSharesetsPreviewResult(plan, result).assets.map(({ id }) => id)).toEqual(
      plan.assets.map(({ id }) => id)
    );
  });

  it("rejects missing, extra, mis-sized, misnamed, or untrusted assets", async () => {
    const { plan, result } = await fixture();
    const malformed = structuredClone(result);
    malformed.assets[0].path = "publisher-cover.png";
    malformed.assets[0].width += 1;
    malformed.assets[0].source = { ...malformed.assets[0].source, generator: "publisher" };
    malformed.assets.push({ ...result.assets[0], id: "promo" });

    expect(() => validateSharesetsPreviewResult(plan, malformed)).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "invalidPreviewAssetPath" }),
          expect.objectContaining({ code: "invalidPreviewWidth" }),
          expect.objectContaining({ code: "previewSourceMismatch" }),
          expect.objectContaining({ code: "unexpectedPreviewAsset" }),
        ]),
      })
    );
    expect(() => validateSharesetsPreviewResult(plan, { ...result, assets: [] })).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ code: "missingPreviewAsset" })]),
      })
    );
  });

  it("accepts a cropped asset at any size inside its viewport and nothing larger", async () => {
    const { plan, result } = await fixture();
    const croppedPlan = {
      ...plan,
      assets: plan.assets.map((asset, index) =>
        index === 0 ? { ...asset, crop: "dialog" } : asset
      ),
    };
    const { widthCssPx, heightCssPx } = plan.assets[0].viewport;
    const sized = (width, height) => ({
      ...result,
      assets: result.assets.map((asset, index) =>
        index === 0 ? { ...asset, width, height } : asset
      ),
    });

    expect(
      validateSharesetsPreviewResult(croppedPlan, sized(widthCssPx - 48, 300)).assets[0]
    ).toMatchObject({ width: widthCssPx - 48, height: 300 });
    expect(() => validateSharesetsPreviewResult(plan, sized(widthCssPx - 48, 300))).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ code: "invalidPreviewWidth" })]),
      })
    );
    expect(() =>
      validateSharesetsPreviewResult(croppedPlan, sized(widthCssPx + 1, heightCssPx + 1))
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "invalidPreviewWidth" }),
          expect.objectContaining({ code: "invalidPreviewHeight" }),
        ]),
      })
    );
  });
});
