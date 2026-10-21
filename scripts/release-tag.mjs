// Preview builds create immutable `preview-*` tags on ordinary development commits. Those tags are
// delivery records, not release baselines, and must never shorten a since-last-release comparison.
export const STABLE_RELEASE_TAG_GLOB = "v[0-9]*.[0-9]*.[0-9]*";
