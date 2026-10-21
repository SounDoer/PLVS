import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { DEFAULT_FOCUS_VIEW } from "./focusView.js";
import { DEFAULT_LOUDNESS_PROFILE_ID, profileSelectionId } from "./loudnessProfileCatalog.js";

export const DEFAULT_PRESET_ID = "default";
export const DEFAULT_PRESET_NAME = "PLVS Default";

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * The canonical product content behind the first-run PLVS Default Preset and its Sharesets Included
 * listing. Runtime copies substitute the starter Profile's local ID and may add machine-local
 * window bounds; neither changes the portable Preset content.
 */
export function createDefaultPreset({
  id = DEFAULT_PRESET_ID,
  loudnessProfileId = DEFAULT_LOUDNESS_PROFILE_ID,
} = {}) {
  return {
    id,
    name: DEFAULT_PRESET_NAME,
    ...clone(DEFAULT_WORKSPACE_STATE),
    windowPinned: false,
    focusView: clone(DEFAULT_FOCUS_VIEW),
    surfaceOpacity: 100,
    glassEnabled: false,
    dock: { enabled: false },
    loudnessProfileActive: profileSelectionId(loudnessProfileId),
  };
}

export const DEFAULT_PRESET = createDefaultPreset();
