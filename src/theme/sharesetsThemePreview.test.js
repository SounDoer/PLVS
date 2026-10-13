import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import {
  buildSharesetsThemePreviewPlan,
  SHARESETS_THEME_PREVIEW_ASSETS,
  SharesetsThemePreviewArtifactError,
  SharesetsThemePreviewRequestError,
  validateSharesetsThemePreviewArtifacts,
  validateSharesetsThemePreviewRequest,
} from "./sharesetsThemePreview.js";
import { themeToPortable } from "./portableTheme.js";

function portableTheme() {
  return themeToPortable({
    ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
    id: "custom-sharesets-preview",
    name: "Sharesets Preview",
  });
}

describe("sharesets Theme preview contract", () => {
  it("builds one immutable PLVS-owned plan for every published image", async () => {
    const plan = await buildSharesetsThemePreviewPlan({ theme: portableTheme() });

    expect(plan).toMatchObject({
      contractVersion: 1,
      generator: "plvs-theme-gallery",
      generatorSource: "plvs",
      acceptsPublisherMedia: false,
      interactivePreview: false,
      fixture: expect.objectContaining({ id: "plvs-sharesets-discovery-stereo-v1", version: 1 }),
      multichannelFixture: expect.objectContaining({
        id: "plvs-sharesets-discovery-5-1-v1",
        version: 1,
      }),
      fixtureHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      theme: {
        contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        colorScheme: "dark",
        formatVersion: 1,
        semanticsVersion: 5,
        document: expect.objectContaining({ kind: "plvs-theme", name: "Sharesets Preview" }),
      },
      sharesetsPublication: { eligible: true, blockers: [] },
    });
    expect(plan.assets.map(({ source: _source, ...asset }) => asset)).toEqual(
      SHARESETS_THEME_PREVIEW_ASSETS
    );
    expect(plan.assets[0]).toMatchObject({
      id: "product-workspace-file",
      kind: "product",
      renderer: "product-gallery",
      format: "png",
      source: {
        generator: "plvs-theme-gallery",
        contractVersion: 1,
        themeContentHash: plan.theme.contentHash,
        fixtureHash: plan.fixtureHash,
      },
    });
    expect(plan.assets.map(({ id }) => id)).toEqual([
      "product-workspace-file",
      "product-multichannel-monitoring",
      "product-workspace-snapshot",
      "semantic-overview",
    ]);
    expect(plan.assets.filter(({ kind }) => kind === "product")).toHaveLength(3);
    expect(plan.assets.find(({ id }) => id === "product-workspace-file")?.viewport).toEqual({
      widthCssPx: 1280,
      heightCssPx: 800,
      deviceScaleFactor: 1,
    });
    expect(plan.assets.find(({ id }) => id === "product-workspace-snapshot")?.viewport).toEqual({
      widthCssPx: 1280,
      heightCssPx: 800,
      deviceScaleFactor: 1,
    });
    expect(
      /** @type {Array<Record<string, any>>} */ (plan.assets).filter(
        ({ crop }) => crop !== undefined
      )
    ).toHaveLength(1);
  });

  it.each(["screenshots", "previews", "media", "thumbnail", "coverImage", "imageUrl"])(
    "rejects publisher-controlled %s before generation",
    (field) => {
      expect(() =>
        validateSharesetsThemePreviewRequest({ theme: portableTheme(), [field]: ["mine.png"] })
      ).toThrowError(
        expect.objectContaining({
          issues: [
            expect.objectContaining({ code: "publisherMediaNotAllowed", path: `$.${field}` }),
          ],
        })
      );
    }
  );

  it("rejects malformed requests and keeps portable validation at the same boundary", () => {
    expect(() => validateSharesetsThemePreviewRequest(null)).toThrow(
      SharesetsThemePreviewRequestError
    );
    expect(() => validateSharesetsThemePreviewRequest({ theme: {} })).toThrow(
      "The portable Theme document is invalid."
    );
  });

  it("seals the exact generated set and rejects any additional screenshot", async () => {
    const plan = await buildSharesetsThemePreviewPlan({ theme: portableTheme() });
    const generated = plan.assets.map(({ id, source }, index) => ({
      id,
      mediaType: "image/png",
      sha256: `sha256:${index.toString(16).padStart(64, "0")}`,
      source,
    }));

    expect(validateSharesetsThemePreviewArtifacts(plan, generated).map(({ id }) => id)).toEqual(
      plan.assets.map(({ id }) => id)
    );
    expect(() =>
      validateSharesetsThemePreviewArtifacts(plan, [
        ...generated,
        {
          id: "author-promo",
          mediaType: "image/png",
          sha256: `sha256:${"f".repeat(64)}`,
          source: generated[0].source,
        },
      ])
    ).toThrowError(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ code: "unexpectedAsset", path: "$[4].id" }),
        ]),
      })
    );
  });

  it("rejects missing or externally sourced generated assets", async () => {
    const plan = await buildSharesetsThemePreviewPlan({ theme: portableTheme() });
    const generated = plan.assets.map(({ id, source }, index) => ({
      id,
      mediaType: "image/png",
      sha256: `sha256:${index.toString(16).padStart(64, "0")}`,
      source,
    }));
    generated[0].source = { ...generated[0].source, generator: "publisher-upload" };
    generated.pop();

    expect(() => validateSharesetsThemePreviewArtifacts(plan, generated)).toThrow(
      SharesetsThemePreviewArtifactError
    );
    try {
      validateSharesetsThemePreviewArtifacts(plan, generated);
    } catch (error) {
      expect(error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "untrustedAssetSource" }),
          expect.objectContaining({ code: "missingAsset" }),
        ])
      );
    }
  });
});
