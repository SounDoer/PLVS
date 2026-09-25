import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "../src/theme/builtinThemesV2.js";
import { hashPortableTheme, themeToPortable } from "../src/theme/portableTheme.js";
import { readCommunitySource } from "./community-catalogue-source.mjs";

describe("initial official Community Catalogue", () => {
  it("ships exactly one PLVS-authored official Listing per supported family", async () => {
    const source = await readCommunitySource("community/catalogue");
    const listings = source.listings.map(({ document }) => document);

    expect(listings.map(({ id }) => id).sort()).toEqual([
      "i-23-tp-1",
      "signal-amber",
      "stereo-overview",
    ]);
    expect(listings.map(({ type }) => type).sort()).toEqual(["loudness", "presets", "themes"]);
    expect(listings.every(({ classification }) => classification === "official")).toBe(true);
    expect(listings.every(({ author }) => author?.name === "PLVS")).toBe(true);
    expect(listings.every(({ releases }) => releases.length === 1)).toBe(true);
  });

  it("keeps the parameter-named Loudness Profile explicit and non-certifying", async () => {
    const source = await readCommunitySource("community/catalogue");
    const profile = source.listings.find(({ document }) => document.type === "loudness").document;
    const searchableCopy = [profile.title, profile.summary, profile.descriptionMarkdown].join(" ");

    expect(profile.title).toBe("I −23 ±0.5 · TP ≤ −1");
    expect(profile.descriptionMarkdown).toContain(
      "editable monitoring rule set, not a certified delivery standard"
    );
    expect(searchableCopy).not.toMatch(/YouTube|Spotify|Netflix|broadcaster|endorsement/i);
    expect(profile.releases[0].metadata.content.summary).toMatchObject({
      referenceLufs: -23,
      ruleCount: 3,
      metricIds: ["integrated", "truePeak"],
    });
  });

  it("publishes a distinct custom Theme and a dependency-free stereo Workspace", async () => {
    const source = await readCommunitySource("community/catalogue");
    const theme = source.listings.find(({ document }) => document.type === "themes").document;
    const preset = source.listings.find(({ document }) => document.type === "presets").document;
    const builtinHash = await hashPortableTheme(themeToPortable(BUILTIN_THEMES_V2["plvs-dark"]));

    expect(theme.title).toBe("Signal Amber");
    expect(theme.releases[0].metadata.content.contentHash).not.toBe(builtinHash);
    expect(preset.title).toBe("Stereo Overview");
    expect(preset.releases[0].metadata.facets).toMatchObject({
      moduleIds: ["levelMeter", "loudness", "spectrum", "stats", "stereo-map", "vectorscope"],
      dependencyIds: [],
      optionalCapabilities: [],
    });
  });
});
