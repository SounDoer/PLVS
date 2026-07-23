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

const TEST_PROFILE = {
  id: "test-profile",
  name: "Test profile",
  referenceLufs: -23,
  rules: [
    { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
    { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
    { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
  ],
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

  it("normalizes imported interface size settings", () => {
    expect(
      buildProfileSnapshot({ settings: { interfaceSize: "extra-large" } }).settings.interfaceSize
    ).toBe("extra-large");
    expect(
      buildProfileSnapshot({ settings: { interfaceSize: "huge" } }).settings.interfaceSize
    ).toBe("default");
  });

  it("round-trips the flat loudness profile library", () => {
    const loudnessProfiles = {
      active: "profile:test-profile",
      profiles: [TEST_PROFILE],
    };

    expect(
      buildProfileSnapshot({ settings: { loudnessProfiles } }).settings.loudnessProfiles
    ).toEqual(loudnessProfiles);
  });

  it("keeps a preset selection that exists in the settings profile library", () => {
    const profile = buildProfileSnapshot({
      settings: {
        loudnessProfiles: { active: "off", profiles: [TEST_PROFILE] },
      },
      presets: {
        list: [{ ...VALID_PRESET, loudnessProfileActive: "profile:test-profile" }],
        activeId: "p1",
      },
    });

    expect(profile.presets.list[0].loudnessProfileActive).toBe("profile:test-profile");
  });

  it("turns a dangling preset profile selection Off", () => {
    const profile = buildProfileSnapshot({
      settings: {
        loudnessProfiles: { active: "off", profiles: [TEST_PROFILE] },
      },
      presets: {
        list: [{ ...VALID_PRESET, loudnessProfileActive: "profile:missing" }],
        activeId: "p1",
      },
    });

    expect(profile.presets.list[0].loudnessProfileActive).toBe("off");
  });

  it.each([undefined, ["builtin", "ebu-r128"].join(":"), ["user", "test-profile"].join(":")])(
    "turns a missing or legacy preset selection Off (%s)",
    (loudnessProfileActive) => {
      const preset = { ...VALID_PRESET };
      if (loudnessProfileActive !== undefined) preset.loudnessProfileActive = loudnessProfileActive;

      const profile = buildProfileSnapshot({
        settings: {
          loudnessProfiles: { active: "off", profiles: [TEST_PROFILE] },
        },
        presets: { list: [preset], activeId: "p1" },
      });

      expect(profile.presets.list[0].loudnessProfileActive).toBe("off");
    }
  );

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
