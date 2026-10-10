import { assessPortableThemeSharesetsPublication, hashPortableTheme } from "./portableTheme.js";
import { SHARESETS_PREVIEW_FIXTURE_V5 } from "../transfer/fixtures/sharesetsPreviewV5.js";
import { hashSharesetsPreviewFixture } from "../transfer/sharesetsPreview.js";

export const SHARESETS_THEME_PREVIEW_CONTRACT_VERSION = 2;

const SEMANTIC_VIEWPORT = Object.freeze({
  widthCssPx: 1440,
  heightCssPx: 1120,
  deviceScaleFactor: 1,
});
const WORKSPACE_VIEWPORT = Object.freeze({
  widthCssPx: 1280,
  heightCssPx: 800,
  deviceScaleFactor: 1,
});
const PANEL_VIEWPORT = Object.freeze({
  widthCssPx: 720,
  heightCssPx: 480,
  deviceScaleFactor: 1,
});

export const SHARESETS_THEME_PREVIEW_ASSETS = Object.freeze([
  Object.freeze({
    id: "semantic-overview",
    kind: "semantic",
    renderer: "semantic-gallery",
    format: "png",
    viewport: SEMANTIC_VIEWPORT,
    // The gallery is a dialog laid out in this viewport; only the dialog is published, so the image
    // is as tall as its content rather than as tall as the viewport.
    crop: "dialog",
  }),
  ...[
    "workspace-file",
    "workspace-snapshot",
    "level-meter-file",
    "loudness-file",
    "stats-file",
    "vectorscope-file",
    "spectrum-file",
    "spectrogram-heatmap",
    "waveform-file",
    "stereo-map-file",
  ].map((sceneId) =>
    Object.freeze({
      id: `product-${sceneId}`,
      kind: "product",
      renderer: "product-gallery",
      sceneId,
      format: "png",
      viewport: sceneId.startsWith("workspace-") ? WORKSPACE_VIEWPORT : PANEL_VIEWPORT,
    })
  ),
]);

export class SharesetsThemePreviewRequestError extends Error {
  constructor(issues) {
    super("The sharesets Theme preview request is invalid.");
    this.name = "SharesetsThemePreviewRequestError";
    this.code = "invalidSharesetsThemePreviewRequest";
    this.issues = issues;
  }
}

export class SharesetsThemePreviewArtifactError extends Error {
  constructor(issues) {
    super("The generated sharesets Theme preview assets are invalid.");
    this.name = "SharesetsThemePreviewArtifactError";
    this.code = "invalidSharesetsThemePreviewArtifacts";
    this.issues = issues;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * The preview generator deliberately accepts only the immutable portable Theme. Catalogue copy,
 * author metadata, uploaded screenshots, URLs, thumbnails, and other media never enter this trust
 * boundary, so every publishable image has to be produced by the versioned PLVS render plan.
 */
/**
 * The preview generator deliberately accepts only the immutable portable Theme. Catalogue copy,
 * author metadata, uploaded screenshots, URLs, thumbnails, and other media never enter this trust
 * boundary, so every publishable image has to be produced by the versioned PLVS render plan.
 */
export function validateSharesetsThemePreviewRequest(raw) {
  if (!isPlainObject(raw)) {
    throw new SharesetsThemePreviewRequestError([
      { code: "invalidRequest", path: "$", message: "The request must be a plain object." },
    ]);
  }
  const unknownFields = Object.keys(raw).filter((field) => field !== "theme");
  if (unknownFields.length > 0) {
    throw new SharesetsThemePreviewRequestError(
      unknownFields.map((field) => ({
        code: "publisherMediaNotAllowed",
        path: `$.${field}`,
        message: `${field} is not accepted by the PLVS preview generator.`,
      }))
    );
  }
  return { theme: assessPortableThemeSharesetsPublication(raw.theme) };
}

/** Build the complete, deterministic render plan for one immutable Theme artefact. */
/**
 * Build the complete, deterministic render plan for one immutable Theme artefact.
 */
export async function buildSharesetsThemePreviewPlan(raw) {
  const { theme: assessment } = validateSharesetsThemePreviewRequest(raw);
  const contentHash = await hashPortableTheme(assessment.document);
  const fixtureHash = await hashSharesetsPreviewFixture(SHARESETS_PREVIEW_FIXTURE_V5);
  return {
    contractVersion: SHARESETS_THEME_PREVIEW_CONTRACT_VERSION,
    generator: "plvs-theme-gallery",
    generatorSource: "plvs",
    acceptsPublisherMedia: false,
    interactivePreview: false,
    fixture: structuredClone(SHARESETS_PREVIEW_FIXTURE_V5),
    fixtureHash,
    theme: {
      contentHash,
      colorScheme: assessment.document.colorScheme,
      formatVersion: assessment.document.formatVersion,
      semanticsVersion: assessment.document.semanticsVersion,
      document: assessment.document,
    },
    sharesetsPublication: assessment.sharesetsPublication,
    assets: SHARESETS_THEME_PREVIEW_ASSETS.map((asset) => ({
      ...asset,
      source: {
        generator: "plvs-theme-gallery",
        contractVersion: SHARESETS_THEME_PREVIEW_CONTRACT_VERSION,
        themeContentHash: contentHash,
        fixtureHash,
      },
    })),
  };
}

/**
 * Seal only the exact PNG set named by the PLVS contract. This rejects missing, additional, or
 * externally sourced images before a catalogue record can reference them.
 */
/**
 * Seal only the exact PNG set named by the PLVS contract. This rejects missing, additional, or
 * externally sourced images before a catalogue record can reference them.
 */
export function validateSharesetsThemePreviewArtifacts(plan, rawArtifacts) {
  const issues = [];
  if (plan?.sharesetsPublication?.eligible !== true) {
    issues.push({
      code: "publicationBlocked",
      path: "$.sharesetsPublication",
      message: "Preview assets cannot be published while the Theme has publication blockers.",
    });
  }
  if (!Array.isArray(rawArtifacts)) {
    throw new SharesetsThemePreviewArtifactError([
      { code: "invalidAssets", path: "$", message: "Generated assets must be an array." },
    ]);
  }

  const expectedById = new Map(SHARESETS_THEME_PREVIEW_ASSETS.map((asset) => [asset.id, asset]));
  const receivedIds = new Set();
  for (const [index, artifact] of rawArtifacts.entries()) {
    const path = `$[${index}]`;
    if (!isPlainObject(artifact) || typeof artifact.id !== "string") {
      issues.push({ code: "invalidAsset", path, message: "Each asset must have an ID." });
      continue;
    }
    if (receivedIds.has(artifact.id)) {
      issues.push({
        code: "duplicateAsset",
        path: `${path}.id`,
        message: `Duplicate preview asset: ${artifact.id}.`,
      });
      continue;
    }
    receivedIds.add(artifact.id);
    const expected = expectedById.get(artifact.id);
    if (!expected) {
      issues.push({
        code: "unexpectedAsset",
        path: `${path}.id`,
        message: `The preview contract does not publish ${artifact.id}.`,
      });
      continue;
    }
    if (artifact.mediaType !== "image/png") {
      issues.push({
        code: "invalidMediaType",
        path: `${path}.mediaType`,
        message: `${artifact.id} must be a PNG.`,
      });
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(artifact.sha256 ?? "")) {
      issues.push({
        code: "invalidArtifactHash",
        path: `${path}.sha256`,
        message: `${artifact.id} must have a SHA-256 content hash.`,
      });
    }
    const source = artifact.source;
    if (
      !isPlainObject(source) ||
      source.generator !== "plvs-theme-gallery" ||
      source.contractVersion !== SHARESETS_THEME_PREVIEW_CONTRACT_VERSION ||
      source.themeContentHash !== plan?.theme?.contentHash ||
      source.fixtureHash !== plan?.fixtureHash
    ) {
      issues.push({
        code: "untrustedAssetSource",
        path: `${path}.source`,
        message: `${artifact.id} was not generated for this Theme by the current PLVS contract.`,
      });
    }
  }

  for (const id of expectedById.keys()) {
    if (!receivedIds.has(id)) {
      issues.push({
        code: "missingAsset",
        path: "$",
        message: `The required preview asset ${id} is missing.`,
      });
    }
  }
  if (issues.length > 0) throw new SharesetsThemePreviewArtifactError(issues);
  return SHARESETS_THEME_PREVIEW_ASSETS.map(({ id }) =>
    structuredClone(rawArtifacts.find((artifact) => artifact.id === id))
  );
}
