import fixture from "./communityPreviewV3.json" with { type: "json" };

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Generated from the production file-analysis pipeline. Regenerate only with
// `npm run community:fixture -- --write`; never hand-edit the JSON payload.
export const COMMUNITY_PREVIEW_FIXTURE_V3 = deepFreeze(fixture);
