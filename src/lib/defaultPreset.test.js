import { describe, expect, it } from "vitest";
import { presetToPortable } from "../transfer/portablePreset.js";
import { DEFAULT_LOUDNESS_PROFILE } from "./loudnessProfileCatalog.js";
import {
  DEFAULT_PRESET,
  DEFAULT_PRESET_ID,
  DEFAULT_PRESET_NAME,
  createDefaultPreset,
} from "./defaultPreset.js";

describe("PLVS Default Preset product source", () => {
  it("exports the current first-run workspace with PLVS Default attached", () => {
    const portable = presetToPortable(DEFAULT_PRESET, {
      loudnessProfiles: [DEFAULT_LOUDNESS_PROFILE],
    });

    expect(DEFAULT_PRESET).toMatchObject({
      id: DEFAULT_PRESET_ID,
      name: DEFAULT_PRESET_NAME,
      windowPinned: false,
      surfaceOpacity: 100,
      glassEnabled: false,
      dock: { enabled: false },
      loudnessProfileActive: "profile:default",
    });
    expect(portable).toMatchObject({
      name: DEFAULT_PRESET_NAME,
      dock: { enabled: false },
      loudnessProfile: { dependencyId: "default" },
    });
    expect(portable.workspace.panels).toHaveLength(8);
  });

  it("can bind the same content to the starter Profile's local ID", () => {
    expect(createDefaultPreset({ loudnessProfileId: "starter-local" })).toMatchObject({
      loudnessProfileActive: "profile:starter-local",
    });
  });
});
