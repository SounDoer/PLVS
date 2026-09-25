import {
  assessPortableLoudnessProfileCommunityPublication,
  PortableLoudnessProfileError,
} from "../lib/portableLoudnessProfile.js";
import {
  assessPortableThemeCommunityPublication,
  PortableThemeError,
} from "../theme/portableTheme.js";
import { PackValidationError, packDescriptor, parsePack } from "./packShape.js";
import { PACK_V2_VERSION, packIssue, prefixPackIssues } from "./packV2.js";
import { assessPortablePresetCommunityPublication, PortablePresetError } from "./portablePreset.js";

const ASSESSORS = {
  loudness: {
    errorType: PortableLoudnessProfileError,
    assess: assessPortableLoudnessProfileCommunityPublication,
  },
  presets: {
    errorType: PortablePresetError,
    assess: assessPortablePresetCommunityPublication,
  },
  themes: {
    errorType: PortableThemeError,
    assess: assessPortableThemeCommunityPublication,
  },
};

/**
 * Strict validation for one immutable Community artifact. Ordinary desktop packs may carry many
 * primary Items; a Community Listing Release always has exactly one.
 */
export function validatePublishablePack(raw, expectedType) {
  const family = ASSESSORS[expectedType];
  if (!family) {
    throw new PackValidationError(
      `Community publication is not implemented for ${packDescriptor(expectedType).label}.`,
      [
        packIssue(
          "unsupportedCommunityItem",
          "$.kind",
          "This Item family does not yet have a Community publication contract."
        ),
      ]
    );
  }
  if (raw?.version !== PACK_V2_VERSION) {
    throw new PackValidationError("Community publication requires Pack V2.", [
      packIssue("unsupportedPackVersion", "$.version", "version must be 2 for publication."),
    ]);
  }

  const pack = parsePack(raw, expectedType);
  if (raw.items.length !== 1) {
    throw new PackValidationError("A Community release needs exactly one primary Item.", [
      packIssue(
        "invalidPrimaryItemCount",
        "$.items",
        "Community publication requires exactly one primary Item.",
        { count: raw.items.length, required: 1 }
      ),
    ]);
  }

  const { id: _id, ...portableItem } = raw.items[0];
  const dependencyIds = (raw.dependencies ?? []).flatMap((group) =>
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

  if (assessment.communityPublication?.eligible !== true) {
    const blockers = assessment.communityPublication?.blockers ?? [];
    throw new PackValidationError("The primary Item does not pass Community publication policy.", [
      ...blockers.map((blocker) =>
        packIssue(
          "communityPublicationBlocked",
          blocker.path ? `$.items[0]${blocker.path.slice(1)}` : "$.items[0]",
          blocker.message ?? "The Item does not pass Community publication policy.",
          { blocker }
        )
      ),
    ]);
  }

  const usedDependencies = new Set(assessment.compatibility?.dependencyIds ?? []);
  const unusedDependencies = dependencyIds.filter((id) => !usedDependencies.has(id));
  if (unusedDependencies.length > 0) {
    throw new PackValidationError("A Community release cannot carry unused dependencies.", [
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
