import { describe, expect, it } from "vitest";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { deriveSharesetsCatalogueMetadata } from "./sharesetsCatalogueMetadata.js";
import { buildPack } from "./packShape.js";

const PROFILE = {
  id: "broadcast",
  name: "Broadcast",
  referenceLufs: -23,
  rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
};

function artifact(type, items, options) {
  return `${JSON.stringify(buildPack(type, items, options), null, 2)}\n`;
}

describe("Sharesets Catalogue metadata", () => {
  it("derives Loudness Profile summary, facets, identity, and preview contract", async () => {
    const metadata = await deriveSharesetsCatalogueMetadata(artifact("loudness", [PROFILE]), {
      fileName: "broadcast.plvsloudness",
    });

    expect(metadata).toMatchObject({
      metadataVersion: 1,
      content: {
        type: "loudness",
        title: "Broadcast",
        itemId: "broadcast",
        itemKind: "plvs-loudness-profile",
        formatVersion: 1,
        semanticsVersion: 1,
        contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        summary: { referenceLufs: -23, ruleCount: 1, metricIds: ["truePeak"] },
      },
      artifact: {
        fileName: "broadcast.plvsloudness",
        sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      },
      dependencies: [],
      compatibility: { metricIds: ["truePeak"] },
      facets: {
        itemType: "loudness",
        metricIds: ["truePeak"],
        themeScheme: null,
      },
      preview: {
        contractVersion: 2,
        renderer: { name: "plvs-sharesets-preview", version: 2 },
        fixture: {
          id: "plvs-sharesets-discovery-v5",
          version: 5,
          sha256: "sha256:31fbbaa214f2fb49e23480b7967c2c24f588227f67641ca2976693e87892cf69",
        },
      },
    });
  });

  it("derives Preset modules, capabilities, dependency identity, and both render surfaces", async () => {
    const preset = {
      id: "mix",
      name: "Mix",
      ...structuredClone(DEFAULT_WORKSPACE_STATE),
      dock: {
        enabled: true,
        edge: "bottom",
        reserveSpace: true,
        height: 80,
        panelsById: {},
        panelOrder: [],
        panelSizesById: {},
        controlsByPanelId: {},
      },
      loudnessProfileActive: "profile:broadcast",
    };
    const metadata = await deriveSharesetsCatalogueMetadata(
      artifact("presets", [preset], { loudnessProfiles: [PROFILE] }),
      { fileName: "mix.plvspreset" }
    );

    expect(metadata.dependencies).toEqual([
      expect.objectContaining({
        id: "broadcast",
        kind: "plvs-loudness-profile",
        contentHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      }),
    ]);
    expect(metadata.facets).toMatchObject({
      itemType: "presets",
      dependencyIds: ["broadcast"],
      optionalCapabilities: ["dock", "dockReserveSpace"],
    });
    expect(metadata.preview.assets.map(({ id }) => id)).toEqual([
      "preset-workspace",
      "preset-dock",
    ]);
  });

  it("derives the Theme scheme and existing Theme preview contract", async () => {
    const theme = {
      ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
      id: "custom-sharesets",
      name: "Sharesets",
    };
    const metadata = await deriveSharesetsCatalogueMetadata(artifact("themes", [theme]), {
      fileName: "sharesets.plvstheme",
    });

    expect(metadata.facets.themeScheme).toBe("dark");
    expect(metadata.preview).toMatchObject({
      renderer: { name: "plvs-theme-gallery", version: 2 },
      fixture: {
        id: "plvs-sharesets-discovery-v5",
        version: 5,
        sha256: "sha256:31fbbaa214f2fb49e23480b7967c2c24f588227f67641ca2976693e87892cf69",
      },
    });
    expect(metadata.preview.assets).toHaveLength(11);
    expect(metadata.preview.assets.every(({ viewport }) => viewport.deviceScaleFactor === 1)).toBe(
      true
    );
  });

  it("is deterministic and never invents author-owned Listing fields", async () => {
    const text = artifact("loudness", [PROFILE]);
    const first = await deriveSharesetsCatalogueMetadata(text, {
      fileName: "broadcast.plvsloudness",
    });
    const second = await deriveSharesetsCatalogueMetadata(text, {
      fileName: "broadcast.plvsloudness",
    });

    expect(second).toEqual(first);
    expect(first).not.toHaveProperty("author");
    expect(first).not.toHaveProperty("description");
    expect(first).not.toHaveProperty("tags");
    expect(first).not.toHaveProperty("licence");
    expect(first).not.toHaveProperty("releaseNotes");
  });
});
