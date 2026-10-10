import {
  hashPortableLoudnessProfile,
  validatePortableLoudnessProfile,
} from "../lib/portableLoudnessProfile.js";
import { validatePublishablePack } from "./sharesetsPack.js";
import { SHARESETS_PREVIEW_FIXTURE_V5 } from "./fixtures/sharesetsPreviewV5.js";
import { hashPortablePreset } from "./portablePreset.js";

export const SHARESETS_PREVIEW_CONTRACT_VERSION = 2;
export const SHARESETS_PREVIEW_RENDERER_VERSION = 2;

const VIEWPORTS = Object.freeze({
  loudnessSummary: Object.freeze({ widthCssPx: 720, heightCssPx: 540, deviceScaleFactor: 1 }),
  loudnessStats: Object.freeze({ widthCssPx: 720, heightCssPx: 480, deviceScaleFactor: 1 }),
  presetWorkspace: Object.freeze({ widthCssPx: 1280, heightCssPx: 720, deviceScaleFactor: 1 }),
  presetDock: Object.freeze({ widthCssPx: 1280, heightCssPx: 240, deviceScaleFactor: 1 }),
});

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])])
  );
}

export async function hashSharesetsPreviewFixture(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(sortJson(value)));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * @param {string} type
 */
function previewAssets(type, portableItem) {
  if (type === "loudness") {
    return [
      {
        id: "profile-summary",
        renderer: "loudness-profile-summary",
        surface: "summary",
        format: "png",
        viewport: VIEWPORTS.loudnessSummary,
      },
      {
        id: "profile-stats-example",
        renderer: "loudness-profile-stats",
        surface: "stats",
        format: "png",
        viewport: VIEWPORTS.loudnessStats,
      },
    ];
  }
  return [
    {
      id: "preset-workspace",
      renderer: "preset-workspace",
      surface: "workspace",
      format: "png",
      viewport: VIEWPORTS.presetWorkspace,
    },
    ...(portableItem.dock.enabled
      ? [
          {
            id: "preset-dock",
            renderer: "preset-dock",
            surface: "dock",
            format: "png",
            viewport: VIEWPORTS.presetDock,
          },
        ]
      : []),
  ];
}

/**
 * Produces the complete, serializable input for the pinned Sharesets preview renderer. It accepts
 * only already-publishable Pack V2 artifacts and owns every runtime value that would otherwise
 * depend on the machine, clock, audio engine, persistence, locale, or animation timing.
 */
/**
 * Produces the complete, serializable input for the pinned Sharesets preview renderer. It accepts
 * only already-publishable Pack V2 artifacts and owns every runtime value that would otherwise
 * depend on the machine, clock, audio engine, persistence, locale, or animation timing.
 * @param {string} type
 */
export async function buildSharesetsPreviewPlan(rawPack, type) {
  if (type !== "loudness" && type !== "presets") {
    throw new Error(
      "The non-Theme Sharesets preview contract supports Loudness Profiles and Presets."
    );
  }
  const publication = validatePublishablePack(rawPack, type);
  const contentHash =
    type === "loudness"
      ? await hashPortableLoudnessProfile(publication.portableItem)
      : await hashPortablePreset(publication.portableItem);
  const fixtureHash = await hashSharesetsPreviewFixture(SHARESETS_PREVIEW_FIXTURE_V5);
  const dependencyItems = rawPack.dependencies?.flatMap((group) =>
    group.kind === "loudness-profile" ? group.items : []
  );
  const dependencies = await Promise.all(
    (dependencyItems ?? []).map(async ({ id, ...document }) => ({
      id,
      contentHash: await hashPortableLoudnessProfile(validatePortableLoudnessProfile(document)),
      document: validatePortableLoudnessProfile(document),
    }))
  );

  const source = {
    generator: "plvs-sharesets-preview",
    contractVersion: SHARESETS_PREVIEW_CONTRACT_VERSION,
    rendererVersion: SHARESETS_PREVIEW_RENDERER_VERSION,
    itemContentHash: contentHash,
    fixtureHash,
  };
  return {
    contractVersion: SHARESETS_PREVIEW_CONTRACT_VERSION,
    renderer: {
      name: "plvs-sharesets-preview",
      version: SHARESETS_PREVIEW_RENDERER_VERSION,
      locale: "en-US",
      fontSet: "plvs-bundled-v1",
      colorScheme: "dark",
      persistence: false,
      network: false,
      audioEngine: false,
      animations: false,
      clock: "fixture",
      stableRenderBarrier: { documentFonts: "ready", animationFrames: 2, canvases: "settled" },
    },
    fixture: structuredClone(SHARESETS_PREVIEW_FIXTURE_V5),
    fixtureHash,
    item: {
      type,
      contentHash,
      document: publication.portableItem,
      compatibility: publication.assessment.compatibility,
    },
    dependencies,
    assets: previewAssets(type, publication.portableItem).map((asset) => ({ ...asset, source })),
  };
}
