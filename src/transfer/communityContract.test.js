import { describe, expect, it } from "vitest";
import {
  COMMUNITY_ARTIFACT_VALIDATOR_VERSION,
  COMMUNITY_CATALOGUE_METADATA_VERSION,
  COMMUNITY_CONTRACT_VERSION,
  COMMUNITY_PREVIEW_CONTRACT_VERSION,
  COMMUNITY_PREVIEW_RENDERER_VERSION,
  COMMUNITY_PREVIEW_RESULT_VERSION,
  COMMUNITY_THEME_PREVIEW_CONTRACT_VERSION,
  deriveCommunityCatalogueMetadata,
  validateCommunityArtifactText,
} from "./communityContract.js";
import { buildPack } from "./packShape.js";

describe("static Catalogue handoff contract", () => {
  it("exposes every independently versioned boundary from one stable module", () => {
    expect({
      contract: COMMUNITY_CONTRACT_VERSION,
      validator: COMMUNITY_ARTIFACT_VALIDATOR_VERSION,
      metadata: COMMUNITY_CATALOGUE_METADATA_VERSION,
      preview: COMMUNITY_PREVIEW_CONTRACT_VERSION,
      previewRenderer: COMMUNITY_PREVIEW_RENDERER_VERSION,
      previewResult: COMMUNITY_PREVIEW_RESULT_VERSION,
      themePreview: COMMUNITY_THEME_PREVIEW_CONTRACT_VERSION,
    }).toEqual({
      contract: 1,
      validator: 1,
      metadata: 1,
      preview: 1,
      previewRenderer: 1,
      previewResult: 1,
      themePreview: 1,
    });
  });

  it("supports the Catalogue CI validate-then-derive sequence", async () => {
    const pack = buildPack("loudness", [
      {
        id: "broadcast",
        name: "Broadcast",
        referenceLufs: -23,
        rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
      },
    ]);
    const text = `${JSON.stringify(pack, null, 2)}\n`;
    const options = { fileName: "broadcast.plvsloudness" };

    await expect(validateCommunityArtifactText(text, options)).resolves.toMatchObject({
      valid: true,
      type: "loudness",
    });
    await expect(deriveCommunityCatalogueMetadata(text, options)).resolves.toMatchObject({
      metadataVersion: 1,
      content: { title: "Broadcast" },
    });
  });
});
