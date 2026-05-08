export const LOUDNESS_REFERENCE_PROFILE_IDS = {
  ebuR128Minus23: "ebu-r128--23",
  youtubeMinus14: "youtube--14",
  spotifyMinus14: "spotify--14",
};

/**
 * A small, extensible model for "reference" loudness targets used by the UI overlay.
 * This must not affect the measurement engine.
 */
export const LOUDNESS_REFERENCE_PROFILES = [
  {
    id: LOUDNESS_REFERENCE_PROFILE_IDS.ebuR128Minus23,
    label: "EBU R128 (-23 LUFS)",
    targetLufs: -23,
    source: {
      title: "EBU R 128",
      url: "https://tech.ebu.ch/publications/r128",
    },
  },
  {
    id: LOUDNESS_REFERENCE_PROFILE_IDS.youtubeMinus14,
    label: "YouTube (observed -14 LUFS)",
    targetLufs: -14,
    source: {
      title: "YouTube loudness target references (docs)",
      url: "docs/loudness-references.md",
    },
  },
  {
    id: LOUDNESS_REFERENCE_PROFILE_IDS.spotifyMinus14,
    label: "Spotify (-14 LUFS)",
    targetLufs: -14,
    source: {
      title: "Spotify for Artists: Loudness normalization",
      url: "https://support.spotify.com/artists/article/loudness-normalization/",
    },
  },
];

export function getDefaultLoudnessReferenceProfileId() {
  return LOUDNESS_REFERENCE_PROFILE_IDS.ebuR128Minus23;
}

/**
 * @param {unknown} id
 */
export function normalizeLoudnessReferenceProfileId(id) {
  if (typeof id !== "string") return getDefaultLoudnessReferenceProfileId();
  if (LOUDNESS_REFERENCE_PROFILES.some((p) => p.id === id)) return id;
  return getDefaultLoudnessReferenceProfileId();
}

/**
 * @param {unknown} id
 */
export function getLoudnessReferenceProfileById(id) {
  const normalized = normalizeLoudnessReferenceProfileId(id);
  return LOUDNESS_REFERENCE_PROFILES.find((p) => p.id === normalized) ?? LOUDNESS_REFERENCE_PROFILES[0];
}

