import { describe, expect, it } from "vitest";
import {
  PUBLIC_SETTINGS_FIELDS,
  SETTINGS_CONTROL_OWNERS,
  SETTINGS_SURFACE_CONTROLS,
  settingsSurfaceControl,
} from "./settingsSurfaceCatalog.js";
import { PUBLIC_FIELDS } from "./settingsControl.js";

describe("Settings surface authority catalogue", () => {
  it("assigns every Settings control exactly one known owner", () => {
    const ids = SETTINGS_SURFACE_CONTROLS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const control of SETTINGS_SURFACE_CONTROLS) {
      expect(SETTINGS_CONTROL_OWNERS).toContain(control.owner);
      expect(control.id).toMatch(/^[a-z][A-Za-z]+\.[a-z][A-Za-z]+$/);
      if (control.owner === "settings") expect(control.field).toBeTruthy();
      else expect(control.field).toBeUndefined();
      if (control.owner === "userOnly") expect(control.reason).toBeTruthy();
    }
  });

  it("is the authority for the public Settings Control field list", () => {
    expect(PUBLIC_FIELDS).toBe(PUBLIC_SETTINGS_FIELDS);
    expect(PUBLIC_FIELDS).toEqual([
      "openAtLogin",
      "closeBehavior",
      "keyboardShortcuts",
      "interfaceSize",
      "historyRetentionSec",
      "dialogueVadEngine",
      "channelLabels",
    ]);
  });

  it("rejects a Settings UI control with no declared authority", () => {
    expect(settingsSurfaceControl("about.feedback")).toMatchObject({ owner: "ui" });
    expect(() => settingsSurfaceControl("behavior.unownedControl")).toThrow(
      "Unknown Settings surface control"
    );
  });
});
