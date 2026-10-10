import {
  assessPortableLoudnessProfileSharesetsPublication,
  PortableLoudnessProfileError,
} from "../lib/portableLoudnessProfile.js";
import {
  assessPortableThemeSharesetsPublication,
  PortableThemeError,
} from "../theme/portableTheme.js";
import { PackValidationError, packDescriptor, parsePack } from "./packShape.js";
import { PACK_V2_VERSION, packIssue, prefixPackIssues } from "./packV2.js";
import { assessPortablePresetSharesetsPublication, PortablePresetError } from "./portablePreset.js";

const ASSESSORS = {
  loudness: {
    errorType: PortableLoudnessProfileError,
    assess: assessPortableLoudnessProfileSharesetsPublication,
  },
  presets: {
    errorType: PortablePresetError,
    assess: assessPortablePresetSharesetsPublication,
  },
  themes: {
    errorType: PortableThemeError,
    assess: assessPortableThemeSharesetsPublication,
  },
};

/**
 * Strict validation for one immutable Sharesets artifact. Ordinary desktop packs may carry many
 * primary Items; a Sharesets Listing Release always has exactly one.
 */
/**
 * Strict validation for one immutable Sharesets artifact. Ordinary desktop packs may carry many
 * primary Items; a Sharesets Listing Release always has exactly one.
 * @param {string} expectedType
 */
export function validatePublishablePack(raw, expectedType) {
  const family = ASSESSORS[expectedType];
  if (!family) {
    throw new PackValidationError(
      `Sharesets publication is not implemented for ${packDescriptor(expectedType).label}.`,
      [
        packIssue(
          "unsupportedSharesetsItem",
          "$.kind",
          "This Item family does not yet have a Sharesets publication contract."
        ),
      ]
    );
  }
  if (raw?.version !== PACK_V2_VERSION) {
    throw new PackValidationError("Sharesets publication requires Pack V2.", [
      packIssue("unsupportedPackVersion", "$.version", "version must be 2 for publication."),
    ]);
  }

  const pack = parsePack(raw, expectedType);
  if (raw.items.length !== 1) {
    throw new PackValidationError("A Sharesets release needs exactly one primary Item.", [
      packIssue(
        "invalidPrimaryItemCount",
        "$.items",
        "Sharesets publication requires exactly one primary Item.",
        { count: raw.items.length, required: 1 }
      ),
    ]);
  }

  const { id: _id, ...portableItem } = raw.items[0];
  const dependencyIds = (raw.dependencies ?? []).flatMap(
    (/** @type {{ kind: string; items: { id: any; }[]; }} */ group) =>
      group?.kind === "loudness-profile" && Array.isArray(group.items)
        ? group.items.map(({ id }) => id)
        : []
  );
  let assessment;
  try {
    assessment = family.assess(portableItem, { dependencyIds });
  } catch (error) {
    if (!(error instanceof family.errorType)) throw error;
    throw new PackValidationError("The primary Item is not publishable.", [
      ...prefixPackIssues(error.issues, "$.items[0]"),
    ]);
  }

  if (assessment.sharesetsPublication?.eligible !== true) {
    const blockers = assessment.sharesetsPublication?.blockers ?? [];
    throw new PackValidationError("The primary Item does not pass Sharesets publication policy.", [
      ...blockers.map((blocker) =>
        packIssue(
          "sharesetsPublicationBlocked",
          blocker.path ? `$.items[0]${blocker.path.slice(1)}` : "$.items[0]",
          blocker.message ?? "The Item does not pass Sharesets publication policy.",
          { blocker }
        )
      ),
    ]);
  }

  const usedDependencies = new Set(assessment.compatibility?.dependencyIds ?? []);
  const unusedDependencies = dependencyIds.filter((id) => !usedDependencies.has(id));
  if (unusedDependencies.length > 0) {
    throw new PackValidationError("A Sharesets release cannot carry unused dependencies.", [
      packIssue(
        "unusedDependency",
        "$.dependencies",
        "Every bundled dependency must be referenced by the primary Item.",
        { dependencyIds: unusedDependencies }
      ),
    ]);
  }

  return {
    type: expectedType,
    pack,
    primaryItem: pack.items[0],
    portableItem: assessment.document,
    assessment,
  };
}
