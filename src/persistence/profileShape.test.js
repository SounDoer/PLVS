import { describe, expect, it } from "vitest";
import {
  PROFILE_APP,
  PROFILE_EXTENSION,
  PROFILE_KIND,
  PROFILE_VERSION,
  ProfileValidationError,
  buildProfileSnapshot,
  normalizeImportedProfile,
} from "./profileShape.js";

const VALID_PRESET = {
  id: "p1",
  name: "Preset",
  tree: { type: "leaf", tabs: ["levelMeter-1"], activeTab: "levelMeter-1" },
  panelsById: { "levelMeter-1": { id: "levelMeter-1", moduleId: "levelMeter" } },
  panelOrder: ["levelMeter-1"],
  panelControlsById: {},
};

describe("profileShape", () => {
  it("defines the PLVS profile identity", () => {
    expect(PROFILE_APP).toBe("PLVS");
    expect(PROFILE_KIND).toBe("configuration-profile");
    expect(PROFILE_VERSION).toBe(1);
    expect(PROFILE_EXTENSION).toBe("plvsconfig");
  });

  it("builds a complete normalized profile snapshot", () => {
    const profile = buildProfileSnapshot(
      {
        settings: { referenceLufs: "-23", panelOpacity: 120 },
        workspace: { visibleModules: ["levelMeter"] },
        presets: { list: [VALID_PRESET], activeId: "p1" },
        themes: { themes: {}, order: ["missing"] },
        windowBounds: { x: 1.2, y: 2.8, width: 800.4, height: 600.6, isMaximized: true },
        captureDeviceId: "out:3",
        clearShortcut: "CmdOrCtrl+L",
        clearGlobal: true,
      },
      { exportedAt: "2026-06-27T00:00:00.000Z" }
    );

    expect(profile).toMatchObject({
      app: "PLVS",
      kind: "configuration-profile",
      version: 1,
      exportedAt: "2026-06-27T00:00:00.000Z",
      settings: { referenceLufs: -23, panelOpacity: 100 },
      workspace: { visibleModules: ["levelMeter"] },
      presets: { list: [VALID_PRESET], activeId: "p1" },
      themes: { themes: {}, order: [] },
      windowBounds: { x: 1, y: 3, width: 800, height: 601, isMaximized: true },
      captureDeviceId: "out:3",
      clearShortcut: "CmdOrCtrl+L",
      clearGlobal: true,
    });
  });

  it("fills defaults for missing optional fields", () => {
    expect(buildProfileSnapshot({}, { exportedAt: "now" })).toEqual({
      app: "PLVS",
      kind: "configuration-profile",
      version: 1,
      exportedAt: "now",
      settings: {},
      workspace: {},
      presets: { list: [], activeId: null },
      themes: { themes: {}, order: [] },
      windowBounds: null,
      captureDeviceId: "default",
      clearShortcut: "CmdOrCtrl+K",
      clearGlobal: false,
    });
  });

  it("rejects unrelated JSON", () => {
    expect(() => normalizeImportedProfile({ app: "Other" })).toThrow(ProfileValidationError);
    expect(() => normalizeImportedProfile({ app: "Other" })).toThrow(
      "This is not a PLVS configuration file."
    );
  });

  it("rejects future profile versions", () => {
    expect(() =>
      normalizeImportedProfile({
        app: "PLVS",
        kind: "configuration-profile",
        version: PROFILE_VERSION + 1,
      })
    ).toThrow("newer version");
  });

  it("falls back invalid capture device ids to default", () => {
    expect(buildProfileSnapshot({ captureDeviceId: "speaker" }).captureDeviceId).toBe("default");
  });

  it("drops invalid window bounds", () => {
    expect(
      buildProfileSnapshot({ windowBounds: { x: 0, y: 0, width: 0, height: 1 } }).windowBounds
    ).toBeNull();
  });
});
