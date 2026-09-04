import { describe, expect, it } from "vitest";

import { DIALOGUE_VAD_ENGINE_OPTIONS } from "../lib/dialogueVadEngines.js";
import {
  CLOSE_ACTION_OPTIONS,
  DEFAULT_CLOSE_ACTION,
  DEFAULT_DIALOGUE_VAD_ENGINE,
  DEFAULT_HISTORY_RETENTION_SEC,
  DEFAULT_INTERFACE_SIZE,
  HISTORY_RETENTION_OPTIONS_SEC,
  INTERFACE_SIZE_OPTIONS,
} from "../settings/defaults.js";
import {
  buildPublicSettings,
  buildSettingsSchema,
  planSettingsUpdate,
  PUBLIC_FIELDS,
} from "./settingsControl.js";

const RAW_SETTINGS = {
  autostartEnabled: false,
  closeAction: DEFAULT_CLOSE_ACTION,
  clearShortcut: "CmdOrCtrl+K",
  clearGlobal: false,
  interfaceSize: DEFAULT_INTERFACE_SIZE,
  appearance: "system",
  themeId: null,
  resolvedThemeId: "plvs-dark",
  historyRetentionSec: DEFAULT_HISTORY_RETENTION_SEC,
  dialogueVadEngine: DEFAULT_DIALOGUE_VAD_ENGINE,
};

const CONTEXT = {
  autostartReady: true,
  clearShortcutReady: true,
  clearShortcutCapturing: false,
  themeOptions: [{ id: "plvs-dark", name: "Dark", kind: "builtin" }],
  activeEditors: [],
  channelCount: 2,
  channelLabelMode: "auto",
  channelLabelRoles: ["L", "R"],
  channelAutoRoles: ["L", "R"],
};

const publicSettings = () => buildPublicSettings(RAW_SETTINGS, CONTEXT);

describe("the public Settings surface agrees with itself", () => {
  // Read, describe and patch are three hand-written field lists, exactly as Panel Control is. A
  // field present in one and missing from another either advertises what it refuses or accepts
  // what it never mentions.
  it("reads and describes exactly the fields it accepts", () => {
    const fields = [...PUBLIC_FIELDS].sort();
    expect(Object.keys(publicSettings()).sort()).toEqual(fields);
    expect(Object.keys(buildSettingsSchema(publicSettings(), CONTEXT)).sort()).toEqual(fields);
  });

  it("accepts a patch of every field it describes", () => {
    const current = publicSettings();
    for (const field of PUBLIC_FIELDS) {
      // Two fields are not round-trippable by construction: appearance reports a read-only
      // resolvedThemeId, and automatic channel labels report the roles they derive but refuse
      // to be given them back.
      const value =
        field === "appearance"
          ? { mode: current.appearance.mode, themeId: current.appearance.themeId }
          : field === "channelLabels"
            ? {
                channelCount: current.channelLabels.channelCount,
                mode: current.channelLabels.mode,
              }
            : current[field];
      const { issues } = planSettingsUpdate(current, { [field]: value }, CONTEXT);
      expect(issues, field).toEqual([]);
    }
  });

  it("offers each enumerated default among that field's own options", () => {
    const schema = buildSettingsSchema(publicSettings(), CONTEXT);
    for (const [name, field] of Object.entries(schema)) {
      if (field.type !== "enum" || field.default === null) continue;
      expect(field.options, name).toContain(field.default);
    }
  });
});

describe("Settings Control reuses the application's own option lists", () => {
  // A value the GUI offers and App Control rejects is invisible until an agent sends it: the
  // schema itself would be telling the agent the value does not exist.
  it.each([
    ["closeBehavior", CLOSE_ACTION_OPTIONS],
    ["interfaceSize", INTERFACE_SIZE_OPTIONS.map(({ id }) => id)],
    ["historyRetentionSec", HISTORY_RETENTION_OPTIONS_SEC],
    ["dialogueVadEngine", DIALOGUE_VAD_ENGINE_OPTIONS.map(({ id }) => id)],
  ])("offers every %s the app offers", (field, options) => {
    expect(buildSettingsSchema(publicSettings(), CONTEXT)[field].options).toEqual([...options]);
  });
});
