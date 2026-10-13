import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_LOUDNESS_PROFILE } from "../src/lib/loudnessProfileCatalog.js";
import { DEFAULT_PRESET } from "../src/lib/defaultPreset.js";
import {
  hashPortableLoudnessProfile,
  loudnessProfileToPortable,
} from "../src/lib/portableLoudnessProfile.js";
import { BUILTIN_THEMES_V2 } from "../src/theme/builtinThemesV2.js";
import { hashPortableTheme, themeToPortable } from "../src/theme/portableTheme.js";
import { hashPortablePreset, presetToPortable } from "../src/transfer/portablePreset.js";
import { readSharesetsSource } from "./sharesets-catalogue-source.mjs";

const INITIAL_LISTINGS = [
  "listings/plvs-dark.json",
  "listings/plvs-light.json",
  "listings/default-loudness-profile.json",
  "listings/ebu-r-128-programme.json",
  "listings/ebu-r-128-short-form.json",
  "listings/atsc-a-85-short-form.json",
  "listings/atsc-a-85-long-form-monitor.json",
  "listings/spotify.json",
  "listings/apple-podcasts.json",
  "listings/ebu-r-128-streaming-monitor.json",
  "listings/aes77-streaming-speech.json",
  "listings/aes77-streaming-music.json",
  "listings/itu-t-h-872-game-audio.json",
  "listings/itu-t-h-872-portable-game-audio.json",
  "listings/control-room-amber.json",
  "listings/studio-daylight.json",
  "listings/night-circuit.json",
  "listings/phosphor-field.json",
  "listings/graphite-monitor.json",
  "listings/paper-console.json",
  "listings/mono-dark.json",
  "listings/mono-light.json",
  "listings/default-preset.json",
  "listings/multichannel-monitoring.json",
  "listings/stereo-field-check.json",
  "listings/spectral-inspection.json",
  "listings/dynamics-headroom.json",
  "listings/essential-monitoring.json",
  "listings/meter-bridge.json",
  "listings/dialogue-delivery-review.json",
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
      "aes77-streaming-music",
      "aes77-streaming-speech",
      "apple-podcasts",
      "atsc-a-85-long-form-monitor",
      "atsc-a-85-short-form",
      "control-room-amber",
      "default-loudness-profile",
      "default-preset",
      "dialogue-delivery-review",
      "dynamics-headroom",
      "ebu-r-128-programme",
      "ebu-r-128-short-form",
      "ebu-r-128-streaming-monitor",
      "essential-monitoring",
      "graphite-monitor",
      "itu-t-h-872-game-audio",
      "itu-t-h-872-portable-game-audio",
      "meter-bridge",
      "mono-dark",
      "mono-light",
      "multichannel-monitoring",
      "night-circuit",
      "paper-console",
      "phosphor-field",
      "plvs-dark",
      "plvs-light",
      "spectral-inspection",
      "spotify",
      "stereo-field-check",
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

  it("keeps Default linked to the current built-in Loudness Profile", async () => {
    const source = await readLaunchSource();
    const profile = source.listings.find(
      ({ document }) => document.id === "default-loudness-profile"
    ).document;
    const portable = loudnessProfileToPortable(DEFAULT_LOUDNESS_PROFILE);

    expect(profile.title).toBe("PLVS Default");
    expect(profile.included.sourceId).toBe("default");
    expect(profile.included.item).toEqual({ id: "default", ...portable });
    expect(profile.included.metadata.content.contentHash).toBe(
      await hashPortableLoudnessProfile(portable)
    );
    expect(profile.included.previews).toEqual([]);
    expect(profile.releases).toEqual([]);
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

  it("keeps Default linked to the current built-in Preset", async () => {
    const source = await readLaunchSource();
    const preset = source.listings.find(
      ({ document }) => document.id === "default-preset"
    ).document;
    const portable = presetToPortable(DEFAULT_PRESET, {
      loudnessProfiles: [DEFAULT_LOUDNESS_PROFILE],
    });

    expect(preset.title).toBe("Default");
    expect(preset.included.sourceId).toBe("default");
    expect(preset.included.item).toEqual({ id: "default", ...portable });
    expect(preset.included.metadata.content.contentHash).toBe(await hashPortablePreset(portable));
    expect(preset.included.metadata.facets).toMatchObject({
      moduleIds: [
        "levelMeter",
        "loudness",
        "spectrogram",
        "spectrum",
        "stats",
        "stereo-map",
        "vectorscope",
        "waveform",
      ],
      dependencyIds: ["default"],
      optionalCapabilities: [],
    });
    expect(preset.included.previews).toEqual([expect.objectContaining({ id: "preset-workspace" })]);
    expect(preset.releases).toEqual([]);
  });

  it("publishes the source-adaptive Multichannel Monitoring Preset", async () => {
    const source = await readLaunchSource();
    const preset = source.listings.find(
      ({ document }) => document.id === "multichannel-monitoring"
    ).document;

    expect(preset.title).toBe("Multichannel Monitoring");
    expect(preset.releases[0].metadata.facets).toMatchObject({
      moduleIds: ["levelMeter", "spectrum", "stats", "vectorscope", "waveform"],
      dependencyIds: [],
      optionalCapabilities: [],
    });
    expect(preset.releases[0].previews).toEqual([
      expect.objectContaining({
        id: "preset-workspace",
        mediaType: "image/png",
        source: expect.objectContaining({ contractVersion: 4 }),
      }),
    ]);
  });

  it("publishes the focused Stereo Field Check Preset", async () => {
    const source = await readLaunchSource();
    const preset = source.listings.find(
      ({ document }) => document.id === "stereo-field-check"
    ).document;

    expect(preset.title).toBe("Stereo Field Check");
    expect(preset.releases[0].metadata.facets).toMatchObject({
      moduleIds: ["spectrum", "stats", "stereo-map", "vectorscope"],
      dependencyIds: [],
      optionalCapabilities: [],
    });
    expect(preset.releases[0].previews).toEqual([
      expect.objectContaining({
        id: "preset-workspace",
        mediaType: "image/png",
        source: expect.objectContaining({ contractVersion: 4 }),
      }),
    ]);
  });

  it("publishes the focused Spectral Inspection Preset", async () => {
    const source = await readLaunchSource();
    const preset = source.listings.find(
      ({ document }) => document.id === "spectral-inspection"
    ).document;

    expect(preset.title).toBe("Spectral Inspection");
    expect(preset.releases[0].metadata.facets).toMatchObject({
      moduleIds: ["spectrogram", "spectrum", "waveform"],
      dependencyIds: [],
      optionalCapabilities: [],
    });
    expect(preset.releases[0].previews).toEqual([
      expect.objectContaining({
        id: "preset-workspace",
        mediaType: "image/png",
        source: expect.objectContaining({ contractVersion: 4 }),
      }),
    ]);
  });

  it("publishes the focused Dynamics & Headroom Preset", async () => {
    const source = await readLaunchSource();
    const preset = source.listings.find(
      ({ document }) => document.id === "dynamics-headroom"
    ).document;

    expect(preset.title).toBe("Dynamics & Headroom");
    expect(preset.releases[0].metadata.facets).toMatchObject({
      moduleIds: ["levelMeter", "loudness", "stats", "waveform"],
      dependencyIds: [],
      optionalCapabilities: [],
    });
    expect(preset.releases[0].previews).toEqual([
      expect.objectContaining({
        id: "preset-workspace",
        mediaType: "image/png",
        source: expect.objectContaining({ contractVersion: 4 }),
      }),
    ]);
  });

  it("publishes the focused Essential Monitoring Preset", async () => {
    const source = await readLaunchSource();
    const preset = source.listings.find(
      ({ document }) => document.id === "essential-monitoring"
    ).document;

    expect(preset.title).toBe("Essential Monitoring");
    expect(preset.releases[0].metadata.facets).toMatchObject({
      moduleIds: ["levelMeter", "loudness", "stats", "vectorscope"],
      dependencyIds: [],
      optionalCapabilities: [],
    });
    expect(preset.releases[0].previews).toEqual([
      expect.objectContaining({
        id: "preset-workspace",
        mediaType: "image/png",
        source: expect.objectContaining({ contractVersion: 4 }),
      }),
    ]);
  });

  it("publishes Meter Bridge with Stereo and 5.1 previews", async () => {
    const source = await readLaunchSource();
    const preset = source.listings.find(({ document }) => document.id === "meter-bridge").document;

    expect(preset.title).toBe("Meter Bridge");
    expect(preset.releases[0].metadata.facets).toMatchObject({
      moduleIds: ["levelMeter", "waveform"],
      dependencyIds: [],
      optionalCapabilities: [],
    });
    expect(preset.releases[0].previews).toEqual([
      expect.objectContaining({
        id: "preset-workspace-stereo",
        mediaType: "image/png",
        source: expect.objectContaining({ contractVersion: 5 }),
      }),
      expect.objectContaining({
        id: "preset-workspace-5-1",
        mediaType: "image/png",
        source: expect.objectContaining({ contractVersion: 5 }),
      }),
    ]);
    expect(preset.releases[0].previews[0].source.fixtureHash).not.toBe(
      preset.releases[0].previews[1].source.fixtureHash
    );
  });

  it("publishes Dialogue Delivery Review with measured Stereo and 5.1 previews", async () => {
    const source = await readLaunchSource();
    const preset = source.listings.find(
      ({ document }) => document.id === "dialogue-delivery-review"
    ).document;

    expect(preset.title).toBe("Dialogue Delivery Review");
    expect(preset.releases[0].metadata.facets).toMatchObject({
      moduleIds: ["loudness", "stats", "waveform"],
      dependencyIds: [],
      optionalCapabilities: [],
    });
    expect(preset.releases[0].previews).toEqual([
      expect.objectContaining({
        id: "preset-workspace-stereo",
        mediaType: "image/png",
        source: expect.objectContaining({ contractVersion: 5 }),
      }),
      expect.objectContaining({
        id: "preset-workspace-5-1",
        mediaType: "image/png",
        source: expect.objectContaining({ contractVersion: 5 }),
      }),
    ]);
    expect(preset.releases[0].previews[0].source.fixtureHash).not.toBe(
      preset.releases[0].previews[1].source.fixtureHash
    );
  });
});
