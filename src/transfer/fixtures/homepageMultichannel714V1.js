import fixture from "./homepageMultichannel714V1.json" with { type: "json" };

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

// Generated from the production file-analysis pipeline. Regenerate only with
// `npm run homepage:fixture -- --write --stems <dir>`; never hand-edit the JSON payload.
export const HOMEPAGE_MULTICHANNEL_714_V1 = deepFreeze(fixture);
