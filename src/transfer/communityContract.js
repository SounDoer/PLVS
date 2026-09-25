// Stable handoff surface for the static Community Catalogue and its CI. Consumers import this
// module instead of coupling themselves to the internal validator, metadata, or renderer layout.
export const COMMUNITY_CONTRACT_VERSION = 1;

export {
  COMMUNITY_ARTIFACT_VALIDATOR_VERSION,
  validateCommunityArtifactText,
} from "./communityArtifact.js";
export {
  COMMUNITY_CATALOGUE_METADATA_VERSION,
  deriveCommunityCatalogueMetadata,
} from "./communityCatalogueMetadata.js";
export {
  COMMUNITY_PREVIEW_CONTRACT_VERSION,
  COMMUNITY_PREVIEW_RENDERER_VERSION,
  buildCommunityPreviewPlan,
} from "./communityPreview.js";
export {
  COMMUNITY_THEME_PREVIEW_ASSETS,
  COMMUNITY_THEME_PREVIEW_CONTRACT_VERSION,
  buildCommunityThemePreviewPlan,
  validateCommunityThemePreviewArtifacts,
} from "../theme/communityThemePreview.js";
export {
  hashPortableLoudnessProfile,
  serializePortableLoudnessProfile,
} from "../lib/portableLoudnessProfile.js";
export { hashPortablePreset, serializePortablePreset } from "./portablePreset.js";
export { hashPortableTheme, serializePortableTheme } from "../theme/portableTheme.js";
