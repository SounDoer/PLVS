import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { deriveCommunityCatalogueMetadata } from "../src/transfer/communityContract.js";
import { validateCommunityListingRecord } from "./community-catalogue-record.mjs";

export const COMMUNITY_SOURCE_SCHEMA_VERSION = 1;

export class CommunitySourceError extends Error {
  constructor(issues) {
    super("The Community Catalogue source is invalid.");
    this.name = "CommunitySourceError";
    this.code = "invalidCommunitySource";
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

function safeRelativeJsonPath(value) {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) return false;
  const normalized = value.replaceAll("\\", "/");
  return (
    normalized.endsWith(".json") &&
    !normalized.startsWith("/") &&
    !normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function inside(root, candidate) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function validateCommunitySourceManifest(raw) {
  const issues = [];
  if (!isPlainObject(raw)) {
    throw new CommunitySourceError([
      issue("invalidManifest", "$", "The source manifest must be a plain object."),
    ]);
  }
  for (const field of Object.keys(raw)) {
    if (field !== "schemaVersion" && field !== "listings") {
      issues.push(issue("unknownManifestField", `$.${field}`, `Unknown manifest field: ${field}.`));
    }
  }
  if (raw.schemaVersion !== COMMUNITY_SOURCE_SCHEMA_VERSION) {
    issues.push(
      issue(
        "unsupportedSourceSchemaVersion",
        "$.schemaVersion",
        `schemaVersion must be ${COMMUNITY_SOURCE_SCHEMA_VERSION}.`
      )
    );
  }
  if (!Array.isArray(raw.listings)) {
    issues.push(issue("invalidListingIndex", "$.listings", "listings must be an array."));
  }

  const seen = new Set();
  for (const [index, path] of (Array.isArray(raw.listings) ? raw.listings : []).entries()) {
    if (!safeRelativeJsonPath(path)) {
      issues.push(
        issue(
          "invalidListingPath",
          `$.listings[${index}]`,
          "Listing paths must be safe relative .json paths."
        )
      );
      continue;
    }
    const normalized = path.replaceAll("\\", "/");
    if (seen.has(normalized)) {
      issues.push(
        issue(
          "duplicateListingPath",
          `$.listings[${index}]`,
          `Duplicate Listing path: ${normalized}.`
        )
      );
    }
    seen.add(normalized);
  }
  if (issues.length > 0) throw new CommunitySourceError(issues);
  return { schemaVersion: COMMUNITY_SOURCE_SCHEMA_VERSION, listings: [...seen] };
}

async function readJson(path, errorPath) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    throw new CommunitySourceError([
      issue("missingSourceFile", errorPath, "The referenced Community source file is missing.", {
        path,
        cause: error instanceof Error ? error.code : null,
      }),
    ]);
  }
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new CommunitySourceError([
      issue(
        "invalidSourceJson",
        errorPath,
        "The referenced Community source file is not valid JSON.",
        {
          path,
        }
      ),
    ]);
  }
}

async function readArtifact(path, errorPath) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new CommunitySourceError([
      issue("missingArtifact", errorPath, "The referenced Release artifact is missing.", {
        path,
        cause: error instanceof Error ? error.code : null,
      }),
    ]);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (_) {
    throw new CommunitySourceError([
      issue("invalidArtifactEncoding", errorPath, "Release artifacts must use valid UTF-8.", {
        path,
      }),
    ]);
  }
}

function isPng(bytes) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  if (bytes.length < 45 || !bytes.subarray(0, signature.length).equals(signature)) return false;
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") return false;
  if (bytes.readUInt32BE(16) === 0 || bytes.readUInt32BE(20) === 0) return false;
  return bytes.toString("ascii", bytes.length - 8, bytes.length - 4) === "IEND";
}

async function sealPreviews(root, release, metadata, listingIndex, releaseIndex) {
  const expectedIds = metadata.preview.assets.map(({ id }) => id);
  const receivedIds = release.previews.map(({ id }) => id);
  const releasePath = `$.listings[${listingIndex}].releases[${releaseIndex}].previews`;
  if (
    expectedIds.length !== receivedIds.length ||
    expectedIds.some((id) => !receivedIds.includes(id))
  ) {
    throw new CommunitySourceError([
      issue(
        "previewSetMismatch",
        releasePath,
        "Release previews must exactly match the current PLVS preview contract.",
        { expectedIds, receivedIds }
      ),
    ]);
  }

  const previewsById = new Map(release.previews.map((preview) => [preview.id, preview]));
  const sealed = [];
  for (const id of expectedIds) {
    const preview = previewsById.get(id);
    const previewIndex = release.previews.indexOf(preview);
    const errorPath = `${releasePath}[${previewIndex}].path`;
    const filePath = resolve(root, preview.path);
    if (!inside(root, filePath)) {
      throw new CommunitySourceError([
        issue("previewPathEscapesRoot", errorPath, "The preview path escapes the content root."),
      ]);
    }
    let bytes;
    try {
      bytes = await readFile(filePath);
    } catch (error) {
      throw new CommunitySourceError([
        issue("missingPreview", errorPath, "The required generated preview is missing.", {
          path: preview.path,
          cause: error instanceof Error ? error.code : null,
        }),
      ]);
    }
    if (!isPng(bytes)) {
      throw new CommunitySourceError([
        issue("invalidPreviewPng", errorPath, "The preview must be a structurally valid PNG.", {
          path: preview.path,
        }),
      ]);
    }
    sealed.push({
      ...preview,
      mediaType: "image/png",
      byteLength: bytes.byteLength,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      source: {
        renderer: metadata.preview.renderer,
        contractVersion: metadata.preview.contractVersion,
        itemContentHash: metadata.content.contentHash,
        fixtureHash: metadata.preview.fixture?.sha256 ?? null,
      },
    });
  }
  return sealed;
}

function prefixedIssues(error, path, details) {
  if (!Array.isArray(error?.issues)) return null;
  return error.issues.map((entry) => ({
    ...entry,
    path: `${path}${entry.path === "$" ? "" : entry.path.slice(1)}`,
    details: { ...(entry.details ?? {}), ...details },
  }));
}

async function resolveReleases(root, listing, listingIndex) {
  const releases = [];
  for (const [releaseIndex, release] of listing.releases.entries()) {
    const sourcePath = release.artifact;
    const errorPath = `$.listings[${listingIndex}].releases[${releaseIndex}].artifact`;
    const artifactPath = resolve(root, sourcePath);
    if (!inside(root, artifactPath)) {
      throw new CommunitySourceError([
        issue(
          "artifactPathEscapesRoot",
          errorPath,
          "The Release artifact escapes the content root."
        ),
      ]);
    }
    const text = await readArtifact(artifactPath, errorPath);
    let metadata;
    try {
      metadata = await deriveCommunityCatalogueMetadata(text);
    } catch (error) {
      const issues = prefixedIssues(error, errorPath, { sourcePath });
      if (!issues) throw error;
      throw new CommunitySourceError(issues);
    }
    if (metadata.content.type !== listing.type) {
      throw new CommunitySourceError([
        issue(
          "artifactTypeMismatch",
          errorPath,
          `The artifact contains ${metadata.content.type}, but the Listing type is ${listing.type}.`,
          { sourcePath, artifactType: metadata.content.type, listingType: listing.type }
        ),
      ]);
    }
    metadata = {
      ...metadata,
      artifact: { ...metadata.artifact, fileName: basename(sourcePath) },
    };
    const previews = await sealPreviews(root, release, metadata, listingIndex, releaseIndex);
    releases.push({ ...release, previews, metadata });
  }
  return releases;
}

export async function readCommunitySource(contentDirectory) {
  const root = resolve(contentDirectory);
  const manifestPath = resolve(root, "manifest.json");
  if (!inside(root, manifestPath)) throw new Error("Resolved manifest escaped the content root.");
  const manifest = validateCommunitySourceManifest(await readJson(manifestPath, "$"));
  const listings = [];
  const identities = { id: new Map(), slug: new Map(), artifact: new Map(), preview: new Map() };
  for (const [index, relativePath] of manifest.listings.entries()) {
    const path = resolve(root, relativePath);
    if (!inside(root, path)) {
      throw new CommunitySourceError([
        issue(
          "listingPathEscapesRoot",
          `$.listings[${index}]`,
          "The Listing path escapes the content root."
        ),
      ]);
    }
    const raw = await readJson(path, `$.listings[${index}]`);
    try {
      const document = validateCommunityListingRecord(raw);
      for (const [kind, value] of [
        ["id", document.id],
        ["slug", document.slug],
      ]) {
        const first = identities[kind].get(value);
        if (first != null) {
          throw new CommunitySourceError([
            issue(
              kind === "id" ? "duplicateListingId" : "duplicateListingSlug",
              `$.listings[${index}].${kind}`,
              `Duplicate Listing ${kind}: ${value}.`,
              { sourcePath: relativePath, firstSourcePath: first }
            ),
          ]);
        }
        identities[kind].set(value, relativePath);
      }
      for (const [releaseIndex, release] of document.releases.entries()) {
        const key = release.artifact.toLocaleLowerCase("en-US");
        const first = identities.artifact.get(key);
        if (first != null) {
          throw new CommunitySourceError([
            issue(
              "duplicateArtifactPath",
              `$.listings[${index}].releases[${releaseIndex}].artifact`,
              `Each Release must own a distinct artifact path: ${release.artifact}.`,
              { sourcePath: relativePath, firstSourcePath: first }
            ),
          ]);
        }
        identities.artifact.set(key, relativePath);
        for (const [previewIndex, preview] of release.previews.entries()) {
          const previewKey = preview.path.toLocaleLowerCase("en-US");
          const previewFirst = identities.preview.get(previewKey);
          if (previewFirst != null) {
            throw new CommunitySourceError([
              issue(
                "duplicatePreviewPath",
                `$.listings[${index}].releases[${releaseIndex}].previews[${previewIndex}].path`,
                `Each generated preview must have a distinct path: ${preview.path}.`,
                { sourcePath: relativePath, firstSourcePath: previewFirst }
              ),
            ]);
          }
          identities.preview.set(previewKey, relativePath);
        }
      }
      const releases = await resolveReleases(root, document, index);
      listings.push({ sourcePath: relativePath, document: { ...document, releases } });
    } catch (error) {
      if (error instanceof CommunitySourceError) throw error;
      if (!Array.isArray(error?.issues)) throw error;
      throw new CommunitySourceError(
        error.issues.map((entry) => ({
          ...entry,
          path: `$.listings[${index}]${entry.path === "$" ? "" : entry.path.slice(1)}`,
          details: { ...(entry.details ?? {}), sourcePath: relativePath },
        }))
      );
    }
  }
  return { root, manifest, listings };
}
