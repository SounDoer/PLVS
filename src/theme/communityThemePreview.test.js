import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import {
  buildCommunityThemePreviewPlan,
  COMMUNITY_THEME_PREVIEW_ASSETS,
  CommunityThemePreviewArtifactError,
  CommunityThemePreviewRequestError,
  validateCommunityThemePreviewArtifacts,
  validateCommunityThemePreviewRequest,
} from "./communityThemePreview.js";
import { themeToPortable } from "./portableTheme.js";

function portableTheme() {
  return themeToPortable({
    ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
    id: "custom-community-preview",
    name: "Community Preview",
  });
}

describe("community Theme preview contract", () => {
  it("builds one immutable PLVS-owned plan for every published image", async () => {
    const plan = await buildCommunityThemePreviewPlan({ theme: portableTheme() });

    expect(plan).toMatchObject({
      contractVersion: 1,
      generator: "plvs-theme-gallery",
      generatorSource: "plvs",
      acceptsPublisherMedia: false,
      interactivePreview: false,
      fixture: expect.objectContaining({ id: "plvs-community-stereo-v1", version: 1 }),
      fixtureHash: "sha256:b495d86078dc285d562709b0e8345db528f2a28977fdc3aff41070332cbc9ec3",
      theme: {
        contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        colorScheme: "dark",
        formatVersion: 1,
        semanticsVersion: 1,
        document: expect.objectContaining({ kind: "plvs-theme", name: "Community Preview" }),
      },
      communityPublication: { eligible: true, blockers: [] },
    });
    expect(plan.assets.map(({ source: _source, ...asset }) => asset)).toEqual(
      COMMUNITY_THEME_PREVIEW_ASSETS
    );
    expect(plan.assets[0]).toMatchObject({
      id: "semantic-overview",
      kind: "semantic",
      renderer: "semantic-gallery",
      format: "png",
      source: {
        generator: "plvs-theme-gallery",
        contractVersion: 1,
        themeContentHash: plan.theme.contentHash,
        fixtureHash: plan.fixtureHash,
      },
    });
    expect(plan.assets.filter(({ kind }) => kind === "product")).toHaveLength(9);
  });

  it.each(["screenshots", "previews", "media", "thumbnail", "coverImage", "imageUrl"])(
    "rejects publisher-controlled %s before generation",
    (field) => {
      expect(() =>
        validateCommunityThemePreviewRequest({ theme: portableTheme(), [field]: ["mine.png"] })
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
    expect(() => validateCommunityThemePreviewRequest(null)).toThrow(
      CommunityThemePreviewRequestError
    );
    expect(() => validateCommunityThemePreviewRequest({ theme: {} })).toThrow(
      "The portable Theme document is invalid."
    );
  });

  it("seals the exact generated set and rejects any additional screenshot", async () => {
    const plan = await buildCommunityThemePreviewPlan({ theme: portableTheme() });
    const generated = plan.assets.map(({ id, source }, index) => ({
      id,
      mediaType: "image/png",
      sha256: `sha256:${index.toString(16).padStart(64, "0")}`,
      source,
    }));

    expect(validateCommunityThemePreviewArtifacts(plan, generated).map(({ id }) => id)).toEqual(
      plan.assets.map(({ id }) => id)
    );
    expect(() =>
      validateCommunityThemePreviewArtifacts(plan, [
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
          expect.objectContaining({ code: "unexpectedAsset", path: "$[10].id" }),
        ]),
      })
    );
  });

  it("rejects missing or externally sourced generated assets", async () => {
    const plan = await buildCommunityThemePreviewPlan({ theme: portableTheme() });
    const generated = plan.assets.map(({ id, source }, index) => ({
      id,
      mediaType: "image/png",
      sha256: `sha256:${index.toString(16).padStart(64, "0")}`,
      source,
    }));
    generated[0].source = { ...generated[0].source, generator: "publisher-upload" };
    generated.pop();

    expect(() => validateCommunityThemePreviewArtifacts(plan, generated)).toThrow(
      CommunityThemePreviewArtifactError
    );
    try {
      validateCommunityThemePreviewArtifacts(plan, generated);
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
