// Stable handoff surface for the static Sharesets Catalogue and its CI. Consumers import this
// module instead of coupling themselves to the internal validator, metadata, or renderer layout.
export const SHARESETS_CONTRACT_VERSION = 1;

export {
  SHARESETS_ARTIFACT_VALIDATOR_VERSION,
  validateSharesetsArtifactText,
} from "./sharesetsArtifact.js";
export {
  SHARESETS_CATALOGUE_METADATA_VERSION,
  deriveSharesetsCatalogueMetadata,
} from "./sharesetsCatalogueMetadata.js";
export {
  SHARESETS_PREVIEW_CONTRACT_VERSION,
  SHARESETS_PREVIEW_RENDERER_VERSION,
  buildSharesetsPreviewPlan,
} from "./sharesetsPreview.js";
export {
  SHARESETS_PREVIEW_RESULT_VERSION,
  validateSharesetsPreviewResult,
} from "./sharesetsPreviewResult.js";
export {
  SHARESETS_THEME_PREVIEW_ASSETS,
  SHARESETS_THEME_PREVIEW_CONTRACT_VERSION,
  buildSharesetsThemePreviewPlan,
  validateSharesetsThemePreviewArtifacts,
} from "../theme/sharesetsThemePreview.js";
export {
  hashPortableLoudnessProfile,
  serializePortableLoudnessProfile,
} from "../lib/portableLoudnessProfile.js";
export { hashPortablePreset, serializePortablePreset } from "./portablePreset.js";
export { hashPortableTheme, serializePortableTheme } from "../theme/portableTheme.js";
