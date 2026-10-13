import {
  hashPortableLoudnessProfile,
  validatePortableLoudnessProfile,
} from "../lib/portableLoudnessProfile.js";
import { validatePublishablePack } from "./sharesetsPack.js";
import { SHARESETS_PREVIEW_FIXTURE_V5 } from "./fixtures/sharesetsPreviewV5.js";
import { SHARESETS_PREVIEW_MULTICHANNEL_V1 } from "./fixtures/sharesetsPreviewMultichannelV1.js";
import { SHARESETS_PREVIEW_DIALOGUE_STEREO_V1 } from "./fixtures/sharesetsPreviewDialogueStereoV1.js";
import { SHARESETS_PREVIEW_DIALOGUE_MULTICHANNEL_V1 } from "./fixtures/sharesetsPreviewDialogueMultichannelV1.js";
import { hashPortablePreset } from "./portablePreset.js";
import { MULTICHANNEL_MONITORING_PRESET } from "../sharesets-preview/multichannelMonitoringPreset.js";

export const SHARESETS_PREVIEW_CONTRACT_VERSION = 5;
export const SHARESETS_PREVIEW_RENDERER_VERSION = 2;

const LEGACY_PREVIEW_CONTRACT_VERSION = 4;
const PRESET_WORKSPACE_VARIANTS_BY_ITEM_ID = Object.freeze({
  "meter-bridge": Object.freeze(["stereo", "5.1"]),
  "dialogue-delivery-review": Object.freeze(["stereo", "5.1"]),
});

const VIEWPORTS = Object.freeze({
  presetWorkspace: Object.freeze({ widthCssPx: 1280, heightCssPx: 720, deviceScaleFactor: 1 }),
  multichannelPresetWorkspace: Object.freeze({
    widthCssPx: 1280,
    heightCssPx: 800,
    deviceScaleFactor: 1,
  }),
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
function previewAssets(type, portableItem, { itemId = null, multichannelMonitoring = false } = {}) {
  // Loudness Profile cards and detail pages are rendered from their structured rules. A screenshot
  // would duplicate that source of truth and is deliberately not part of the preview contract.
  if (type === "loudness") return [];
  const variants = PRESET_WORKSPACE_VARIANTS_BY_ITEM_ID[itemId] ?? null;
  const workspaceAssets = variants
    ? variants.map((fixtureKey) => ({
        id: `preset-workspace-${fixtureKey === "5.1" ? "5-1" : fixtureKey}`,
        renderer: "preset-workspace",
        fixtureKey,
        surface: "workspace",
        format: "png",
        viewport: VIEWPORTS.presetWorkspace,
      }))
    : [
        {
          id: "preset-workspace",
          renderer: multichannelMonitoring ? "multichannel-monitoring" : "preset-workspace",
          surface: "workspace",
          format: "png",
          viewport: multichannelMonitoring
            ? VIEWPORTS.multichannelPresetWorkspace
            : VIEWPORTS.presetWorkspace,
        },
      ];
  return [
    ...workspaceAssets,
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
  const multichannelMonitoring =
    type === "presets" &&
    contentHash === (await hashPortablePreset(MULTICHANNEL_MONITORING_PRESET));
  const itemId = rawPack.items[0]?.id ?? null;
  const workspaceVariants = PRESET_WORKSPACE_VARIANTS_BY_ITEM_ID[itemId] ?? null;
  const dialoguePreview = itemId === "dialogue-delivery-review";
  const usesMultichannelFixture =
    multichannelMonitoring || workspaceVariants?.includes("5.1") === true;
  const fixture = dialoguePreview
    ? SHARESETS_PREVIEW_DIALOGUE_STEREO_V1
    : multichannelMonitoring
      ? SHARESETS_PREVIEW_MULTICHANNEL_V1
      : SHARESETS_PREVIEW_FIXTURE_V5;
  const fixtureHash = await hashSharesetsPreviewFixture(fixture);
  const multichannelFixture = dialoguePreview
    ? SHARESETS_PREVIEW_DIALOGUE_MULTICHANNEL_V1
    : SHARESETS_PREVIEW_MULTICHANNEL_V1;
  const multichannelFixtureHash = usesMultichannelFixture
    ? await hashSharesetsPreviewFixture(multichannelFixture)
    : null;
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

  const contractVersion = workspaceVariants
    ? SHARESETS_PREVIEW_CONTRACT_VERSION
    : LEGACY_PREVIEW_CONTRACT_VERSION;
  const source = {
    generator: "plvs-sharesets-preview",
    contractVersion,
    rendererVersion: SHARESETS_PREVIEW_RENDERER_VERSION,
    itemContentHash: contentHash,
    fixtureHash,
  };
  const assets = previewAssets(type, publication.portableItem, {
    itemId,
    multichannelMonitoring,
  }).map((asset) => {
    const assetFixtureHash = asset.fixtureKey === "5.1" ? multichannelFixtureHash : fixtureHash;
    return {
      ...asset,
      source: { ...source, fixtureHash: assetFixtureHash },
    };
  });
  return {
    contractVersion,
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
    fixture: structuredClone(fixture),
    fixtureHash,
    ...(workspaceVariants?.includes("5.1")
      ? { multichannelFixture: structuredClone(multichannelFixture) }
      : {}),
    item: {
      type,
      contentHash,
      document: publication.portableItem,
      compatibility: publication.assessment.compatibility,
    },
    dependencies,
    assets,
  };
}
