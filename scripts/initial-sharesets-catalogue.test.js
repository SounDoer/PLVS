import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "../src/theme/builtinThemesV2.js";
import { hashPortableTheme, themeToPortable } from "../src/theme/portableTheme.js";
import { readSharesetsSource } from "./sharesets-catalogue-source.mjs";

const INITIAL_LISTINGS = [
  "listings/plvs-dark.json",
  "listings/plvs-light.json",
  "listings/control-room-amber.json",
  "listings/studio-daylight.json",
  "listings/night-circuit.json",
  "listings/i-23-tp-1.json",
  "listings/phosphor-field.json",
  "listings/graphite-monitor.json",
  "listings/paper-console.json",
  "listings/mono-dark.json",
  "listings/mono-light.json",
  "listings/stereo-overview.json",
];

let launchSource;

beforeAll(async () => {
  launchSource = await readSharesetsSource("sharesets/catalogue");
});

const readLaunchSource = () => launchSource;

describe("initial Sharesets Catalogue", () => {
  it("includes every checked-in candidate in the publication manifest", () => {
    const manifest = JSON.parse(readFileSync("sharesets/catalogue/manifest.json", "utf8"));
    expect(manifest.listings).toEqual(INITIAL_LISTINGS);
  });

  it("keeps the checked-in Listings PLVS-authored and structurally complete", async () => {
    const source = await readLaunchSource();
    const listings = source.listings.map(({ document }) => document);

    expect(listings.map(({ id }) => id).sort()).toEqual([
      "control-room-amber",
      "graphite-monitor",
      "i-23-tp-1",
      "mono-dark",
      "mono-light",
      "night-circuit",
      "paper-console",
      "phosphor-field",
      "plvs-dark",
      "plvs-light",
      "stereo-overview",
      "studio-daylight",
    ]);
    expect(new Set(listings.map(({ type }) => type))).toEqual(
      new Set(["loudness", "presets", "themes"])
    );
    expect(listings.every(({ classification }) => classification === "official")).toBe(true);
    expect(listings.every(({ author }) => author?.name === "PLVS")).toBe(true);
    expect(
      listings.every(({ included, releases }) => Boolean(included) !== (releases.length === 1))
    ).toBe(true);
  });

  it("keeps PLVS Dark linked to the current built-in Theme", async () => {
    const source = await readLaunchSource();
    const theme = source.listings.find(({ document }) => document.id === "plvs-dark").document;
    const builtinHash = await hashPortableTheme(themeToPortable(BUILTIN_THEMES_V2["plvs-dark"]));

    expect(theme.title).toBe("PLVS Dark");
    expect(theme.included.sourceId).toBe("plvs-dark");
    expect(theme.included.metadata.content.contentHash).toBe(builtinHash);
    expect(theme.releases).toEqual([]);
  });

  it("keeps PLVS Light linked to the current built-in Theme", async () => {
    const source = await readLaunchSource();
    const theme = source.listings.find(({ document }) => document.id === "plvs-light").document;
    const builtinHash = await hashPortableTheme(themeToPortable(BUILTIN_THEMES_V2["plvs-light"]));

    expect(theme.title).toBe("PLVS Light");
    expect(theme.included.sourceId).toBe("plvs-light");
    expect(theme.included.metadata.content.contentHash).toBe(builtinHash);
    expect(theme.releases).toEqual([]);
  });

  it("keeps the parameter-named Loudness Profile explicit and non-certifying", async () => {
    const source = await readLaunchSource();
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

  it("keeps Control Room Amber distinct from the built-ins", async () => {
    const source = await readLaunchSource();
    const theme = source.listings.find(
      ({ document }) => document.id === "control-room-amber"
    ).document;
    const builtinHash = await hashPortableTheme(themeToPortable(BUILTIN_THEMES_V2["plvs-dark"]));

    expect(theme.title).toBe("Control Room Amber");
    expect(theme.releases[0].metadata.content.contentHash).not.toBe(builtinHash);
  });

  it("keeps Studio Daylight distinct from the built-ins", async () => {
    const source = await readLaunchSource();
    const theme = source.listings.find(
      ({ document }) => document.id === "studio-daylight"
    ).document;
    const builtinHash = await hashPortableTheme(themeToPortable(BUILTIN_THEMES_V2["plvs-light"]));

    expect(theme.title).toBe("Studio Daylight");
    expect(theme.releases[0].metadata.content.contentHash).not.toBe(builtinHash);
  });

  it("keeps the current stereo Workspace fixture dependency-free", async () => {
    const source = await readLaunchSource();
    const preset = source.listings.find(({ document }) => document.type === "presets").document;

    expect(preset.title).toBe("Stereo Overview");
    expect(preset.releases[0].metadata.facets).toMatchObject({
      moduleIds: ["levelMeter", "loudness", "spectrum", "stats", "stereo-map", "vectorscope"],
      dependencyIds: [],
      optionalCapabilities: [],
    });
  });
});
