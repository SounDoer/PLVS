import { describe, expect, it } from "vitest";
import {
  SHARESETS_ARTIFACT_VALIDATOR_VERSION,
  SHARESETS_CATALOGUE_METADATA_VERSION,
  SHARESETS_CONTRACT_VERSION,
  SHARESETS_PREVIEW_CONTRACT_VERSION,
  SHARESETS_PREVIEW_RENDERER_VERSION,
  SHARESETS_PREVIEW_RESULT_VERSION,
  SHARESETS_THEME_PREVIEW_CONTRACT_VERSION,
  deriveSharesetsCatalogueMetadata,
  validateSharesetsArtifactText,
} from "./sharesetsContract.js";
import { buildPack } from "./packShape.js";

describe("static Catalogue handoff contract", () => {
  it("exposes every independently versioned boundary from one stable module", () => {
    expect({
      contract: SHARESETS_CONTRACT_VERSION,
      validator: SHARESETS_ARTIFACT_VALIDATOR_VERSION,
      metadata: SHARESETS_CATALOGUE_METADATA_VERSION,
      preview: SHARESETS_PREVIEW_CONTRACT_VERSION,
      previewRenderer: SHARESETS_PREVIEW_RENDERER_VERSION,
      previewResult: SHARESETS_PREVIEW_RESULT_VERSION,
      themePreview: SHARESETS_THEME_PREVIEW_CONTRACT_VERSION,
    }).toEqual({
      contract: 1,
      validator: 1,
      metadata: 1,
      preview: 5,
      previewRenderer: 2,
      previewResult: 1,
      themePreview: 3,
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

    await expect(validateSharesetsArtifactText(text, options)).resolves.toMatchObject({
      valid: true,
      type: "loudness",
    });
    await expect(deriveSharesetsCatalogueMetadata(text, options)).resolves.toMatchObject({
      metadataVersion: 1,
      content: { title: "Broadcast" },
    });
  });
});
