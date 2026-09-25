import { PackValidationError, PACK_KINDS, parseSharedPackText } from "./packShape.js";
import { validatePublishablePack } from "./communityPack.js";
import { packIssue } from "./packV2.js";

export const COMMUNITY_ARTIFACT_VALIDATOR_VERSION = 1;

async function sha256Text(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return {
    byteLength: bytes.byteLength,
    sha256: `sha256:${[...new Uint8Array(digest)]
      .map((part) => part.toString(16).padStart(2, "0"))
      .join("")}`,
  };
}

function canonicalPackText(raw) {
  return `${JSON.stringify(raw, null, 2)}\n`;
}

function validateFileName(fileName, type) {
  if (fileName == null) return;
  const extension = `.${PACK_KINDS[type].extension}`;
  if (typeof fileName !== "string" || !fileName.toLowerCase().endsWith(extension)) {
    throw new PackValidationError(
      `A Community ${PACK_KINDS[type].label} artifact must use ${extension}.`,
      [
        packIssue(
          "invalidArtifactExtension",
          "$.fileName",
          `The artifact filename must end in ${extension}.`,
          {
            fileName,
            expectedExtension: extension,
          }
        ),
      ]
    );
  }
}

/**
 * Repository/CI boundary for one immutable Catalogue artifact. Unlike desktop import, publication
 * accepts only strict Pack V2, one primary Item, canonical UTF-8 JSON formatting, and the matching
 * public extension. The returned hash identifies the exact bytes that were validated.
 */
export async function validateCommunityArtifactText(text, { fileName } = {}) {
  const { type } = parseSharedPackText(text);
  const raw = JSON.parse(text);
  validateFileName(fileName, type);

  if (text !== canonicalPackText(raw)) {
    throw new PackValidationError("Community artifacts must use canonical PLVS JSON formatting.", [
      packIssue(
        "nonCanonicalArtifactEncoding",
        "$",
        "Use UTF-8 JSON with two-space indentation and one final newline."
      ),
    ]);
  }

  const publication = validatePublishablePack(raw, type);
  const exactBytes = await sha256Text(text);
  return {
    validatorVersion: COMMUNITY_ARTIFACT_VALIDATOR_VERSION,
    valid: true,
    type,
    artifact: {
      fileName: fileName ?? null,
      mediaType: "application/json",
      ...exactBytes,
      packKind: raw.kind,
      packVersion: raw.version,
    },
    primaryItem: {
      id: raw.items[0].id,
      kind: publication.portableItem.kind,
      name: publication.portableItem.name,
      formatVersion: publication.portableItem.formatVersion,
      semanticsVersion: publication.portableItem.semanticsVersion,
    },
    compatibility: publication.assessment.compatibility,
  };
}
