export const COMMUNITY_PREVIEW_RESULT_VERSION = 1;

const RESULT_FIELDS = new Set([
  "resultVersion",
  "renderer",
  "contentHash",
  "fixtureHash",
  "assets",
]);
const RENDERER_FIELDS = new Set(["name", "version"]);
const ASSET_FIELDS = new Set([
  "id",
  "path",
  "mediaType",
  "width",
  "height",
  "byteLength",
  "sha256",
  "source",
]);

export class CommunityPreviewResultError extends Error {
  constructor(issues) {
    super("The generated Community preview result is invalid.");
    this.name = "CommunityPreviewResultError";
    this.code = "invalidCommunityPreviewResult";
    this.issues = issues;
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function issue(code, path, message, details) {
  return { severity: "error", code, path, message, ...(details ? { details } : {}) };
}

function unknownFields(raw, allowed, path, issues) {
  if (!isPlainObject(raw)) return;
  for (const field of Object.keys(raw)) {
    if (!allowed.has(field)) {
      issues.push(
        issue("unknownPreviewResultField", `${path}.${field}`, `Unknown field: ${field}.`)
      );
    }
  }
}

function expectedIdentity(plan) {
  if (isPlainObject(plan?.renderer) && isPlainObject(plan?.item)) {
    return {
      renderer: { name: plan.renderer.name, version: plan.renderer.version },
      contentHash: plan.item.contentHash,
      fixtureHash: plan.fixtureHash,
    };
  }
  if (typeof plan?.generator === "string" && isPlainObject(plan?.theme)) {
    return {
      renderer: { name: plan.generator, version: plan.contractVersion },
      contentHash: plan.theme.contentHash,
      fixtureHash: null,
    };
  }
  return null;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateCommunityPreviewResult(plan, raw) {
  const issues = [];
  const identity = expectedIdentity(plan);
  if (!identity || !Array.isArray(plan?.assets)) {
    throw new CommunityPreviewResultError([
      issue("invalidPreviewPlan", "$", "A complete Community preview plan is required."),
    ]);
  }
  if (!isPlainObject(raw)) {
    throw new CommunityPreviewResultError([
      issue("invalidPreviewResult", "$", "The preview result must be a plain object."),
    ]);
  }
  unknownFields(raw, RESULT_FIELDS, "$", issues);
  if (raw.resultVersion !== COMMUNITY_PREVIEW_RESULT_VERSION) {
    issues.push(
      issue(
        "unsupportedPreviewResultVersion",
        "$.resultVersion",
        `resultVersion must be ${COMMUNITY_PREVIEW_RESULT_VERSION}.`
      )
    );
  }
  if (!isPlainObject(raw.renderer)) {
    issues.push(issue("invalidPreviewRenderer", "$.renderer", "renderer must be an object."));
  } else {
    unknownFields(raw.renderer, RENDERER_FIELDS, "$.renderer", issues);
    if (!same(raw.renderer, identity.renderer)) {
      issues.push(
        issue("previewRendererMismatch", "$.renderer", "Renderer identity does not match the plan.")
      );
    }
  }
  if (raw.contentHash !== identity.contentHash) {
    issues.push(
      issue("previewContentMismatch", "$.contentHash", "Content hash does not match the plan.")
    );
  }
  if (raw.fixtureHash !== identity.fixtureHash) {
    issues.push(
      issue("previewFixtureMismatch", "$.fixtureHash", "Fixture hash does not match the plan.")
    );
  }
  if (!Array.isArray(raw.assets)) {
    issues.push(issue("invalidPreviewAssets", "$.assets", "assets must be an array."));
  }

  const rawAssets = Array.isArray(raw.assets) ? raw.assets : [];
  const receivedById = new Map();
  for (const [index, asset] of rawAssets.entries()) {
    const path = `$.assets[${index}]`;
    if (!isPlainObject(asset)) {
      issues.push(issue("invalidPreviewAsset", path, "Each preview asset must be an object."));
      continue;
    }
    unknownFields(asset, ASSET_FIELDS, path, issues);
    if (typeof asset.id !== "string") {
      issues.push(issue("invalidPreviewAssetId", `${path}.id`, "Preview asset ID is required."));
      continue;
    }
    if (receivedById.has(asset.id)) {
      issues.push(issue("duplicatePreviewAsset", `${path}.id`, `Duplicate asset: ${asset.id}.`));
      continue;
    }
    receivedById.set(asset.id, { asset, path });
  }

  const normalizedAssets = [];
  for (const expected of plan.assets) {
    const received = receivedById.get(expected.id);
    if (!received) {
      issues.push(issue("missingPreviewAsset", "$.assets", `Missing asset: ${expected.id}.`));
      continue;
    }
    receivedById.delete(expected.id);
    const { asset, path } = received;
    if (asset.path !== `${expected.id}.png`) {
      issues.push(
        issue(
          "invalidPreviewAssetPath",
          `${path}.path`,
          `${expected.id} must use the generated filename ${expected.id}.png.`
        )
      );
    }
    if (asset.mediaType !== "image/png") {
      issues.push(issue("invalidPreviewMediaType", `${path}.mediaType`, "Preview must be a PNG."));
    }
    const expectedViewport = expected.viewport;
    if (
      !Number.isSafeInteger(asset.width) ||
      asset.width < 1 ||
      (expectedViewport && asset.width !== expectedViewport.widthCssPx)
    ) {
      issues.push(issue("invalidPreviewWidth", `${path}.width`, "Preview width is invalid."));
    }
    if (
      !Number.isSafeInteger(asset.height) ||
      asset.height < 1 ||
      (expectedViewport && asset.height !== expectedViewport.heightCssPx)
    ) {
      issues.push(issue("invalidPreviewHeight", `${path}.height`, "Preview height is invalid."));
    }
    if (!Number.isSafeInteger(asset.byteLength) || asset.byteLength < 45) {
      issues.push(
        issue("invalidPreviewByteLength", `${path}.byteLength`, "Preview byte length is invalid.")
      );
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(asset.sha256 ?? "")) {
      issues.push(issue("invalidPreviewHash", `${path}.sha256`, "Preview SHA-256 is invalid."));
    }
    if (!same(asset.source, expected.source)) {
      issues.push(
        issue("previewSourceMismatch", `${path}.source`, "Preview source does not match the plan.")
      );
    }
    normalizedAssets.push(structuredClone(asset));
  }
  for (const [id, { path }] of receivedById) {
    issues.push(issue("unexpectedPreviewAsset", `${path}.id`, `Unexpected asset: ${id}.`));
  }

  if (issues.length > 0) throw new CommunityPreviewResultError(issues);
  return {
    resultVersion: COMMUNITY_PREVIEW_RESULT_VERSION,
    renderer: { ...identity.renderer },
    contentHash: identity.contentHash,
    fixtureHash: identity.fixtureHash,
    assets: normalizedAssets,
  };
}
