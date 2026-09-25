import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
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

export async function readCommunitySource(contentDirectory) {
  const root = resolve(contentDirectory);
  const manifestPath = resolve(root, "manifest.json");
  if (!inside(root, manifestPath)) throw new Error("Resolved manifest escaped the content root.");
  const manifest = validateCommunitySourceManifest(await readJson(manifestPath, "$"));
  const listings = [];
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
      listings.push({ sourcePath: relativePath, document: validateCommunityListingRecord(raw) });
    } catch (error) {
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
