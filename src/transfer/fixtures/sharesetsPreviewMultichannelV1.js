import fixture from "./sharesetsPreviewMultichannelV1.json" with { type: "json" };

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Generated from the attributed preview source through the production file-analysis pipeline.
// Regenerate only with `npm run sharesets:fixture -- --write`; never hand-edit the JSON payload.
export const SHARESETS_PREVIEW_MULTICHANNEL_V1 = deepFreeze(fixture);
