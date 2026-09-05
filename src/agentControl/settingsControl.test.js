import { describe, expect, it } from "vitest";
import {
  buildPublicSettings,
  buildSettingsInspection,
  buildSettingsSchema,
  planSettingsUpdate,
} from "./settingsControl.js";

const current = {
  openAtLogin: false,
  closeBehavior: "ask",
  clearShortcut: { accelerator: "CmdOrCtrl+K", global: false },
  interfaceSize: "default",
  appearance: { mode: "system", themeId: null, resolvedThemeId: "plvs-dark" },
  historyRetentionSec: 3600,
  dialogueVadEngine: "firered",
  channelLabels: { channelCount: 2, mode: "auto", roles: ["L", "R"] },
};

const context = {
  autostartReady: true,
  clearShortcutReady: true,
  clearShortcutCapturing: false,
  themeOptions: [
    { id: "plvs-dark", name: "Dark", kind: "builtin" },
    { id: "custom", name: "Custom", kind: "custom" },
  ],
  activeEditors: [],
  dialogueDetectionActive: false,
  sourceMode: "live",
  channelAutoRoles: ["L", "R"],
};

describe("Settings Control", () => {
  it("maps the application hook state into the public Settings shape", () => {
    expect(
      buildPublicSettings(
        {
          autostartEnabled: true,
          closeAction: "tray",
          clearShortcut: "CmdOrCtrl+L",
          clearGlobal: true,
          interfaceSize: "large",
          appearance: "fixed",
          themeId: "custom",
          resolvedThemeId: "custom",
          historyRetentionSec: 7200,
          dialogueVadEngine: "silero",
        },
        { channelCount: 2, channelLabelMode: "custom", channelLabelRoles: ["L", "R"] }
      )
    ).toEqual({
      openAtLogin: true,
      closeBehavior: "tray",
      clearShortcut: { accelerator: "CmdOrCtrl+L", global: true },
      interfaceSize: "large",
      appearance: { mode: "fixed", themeId: "custom", resolvedThemeId: "custom" },
      historyRetentionSec: 7200,
      dialogueVadEngine: "silero",
      channelLabels: { channelCount: 2, mode: "custom", roles: ["L", "R"] },
    });
  });

  it("never exposes the Agent Control toggle to agents", () => {
    const publicSettings = buildPublicSettings(
      { agentControlEnabled: true, referenceLufs: -23 },
      { channelCount: 2, channelLabelMode: "custom", channelLabelRoles: ["L", "R"] }
    );
    expect(publicSettings).not.toHaveProperty("agentControlEnabled");
  });

  it("describes dynamic Theme and Channel Role options", () => {
    const schema = buildSettingsSchema(current, context);
    expect(schema.appearance.properties.themeId.options).toEqual(context.themeOptions);
    expect(schema.channelLabels.properties.roles.items.options).toContainEqual({
      id: "LFE",
      name: "LFE",
    });
    expect(schema.historyRetentionSec).toMatchObject({
      type: "enum",
      default: 3600,
      current: 3600,
      options: [1800, 3600, 7200, 14400],
      unit: "s",
    });
  });

  it("separates configured settings from runtime and availability", () => {
    expect(buildSettingsInspection(current, context)).toEqual({
      settings: current,
      runtime: {
        clearShortcut: { globalRegistration: "notRequested" },
        dialogueDetection: { requested: false, active: false, engine: null },
      },
      availability: {
        openAtLogin: { writable: true, reason: null },
        clearShortcut: { writable: true, reason: null },
        appearance: { writable: true, reason: null },
        channelLabels: { writable: true, reason: null },
      },
    });
  });

  it("strictly validates every supplied field before planning any mutation", () => {
    const planned = planSettingsUpdate(
      current,
      {
        closeBehavior: "minimize",
        interfaceSize: "huge",
        historyRetentionSec: "1800",
        dialogueVadEngine: "other",
        appearance: { mode: "fixed" },
        clearShortcut: { accelerator: "K" },
        unknown: true,
      },
      context
    );
    expect(planned.changed).toEqual([]);
    expect(planned.issues.map(({ code }) => code)).toEqual([
      "unknownControl",
      "invalidOption",
      "invalidShortcut",
      "invalidOption",
      "themeRequired",
      "invalidOption",
      "invalidOption",
    ]);
  });

  it("merge-patches nested values and reports reduction warnings", () => {
    const planned = planSettingsUpdate(
      current,
      {
        closeBehavior: "tray",
        clearShortcut: { global: true },
        appearance: { mode: "fixed", themeId: "custom" },
        historyRetentionSec: 1800,
      },
      context
    );
    expect(planned.issues).toEqual([]);
    expect(planned.settings).toMatchObject({
      closeBehavior: "tray",
      clearShortcut: { accelerator: "CmdOrCtrl+K", global: true },
      appearance: { mode: "fixed", themeId: "custom", resolvedThemeId: "custom" },
      historyRetentionSec: 1800,
    });
    expect(planned.changed).toEqual([
      "settings.closeBehavior",
      "settings.clearShortcut.global",
      "settings.appearance.mode",
      "settings.appearance.themeId",
      "settings.historyRetentionSec",
    ]);
    expect(planned.warnings).toEqual([
      {
        code: "historyRetentionReduced",
        previous: 3600,
        target: 1800,
      },
    ]);
  });

  it("refuses appearance and shortcut capture dynamically before no-op detection", () => {
    expect(
      planSettingsUpdate(
        current,
        { appearance: { mode: "system" } },
        {
          ...context,
          activeEditors: ["theme"],
        }
      ).refusal
    ).toEqual({ code: "editorActive", editors: ["theme"] });
    expect(
      planSettingsUpdate(
        current,
        { clearShortcut: { global: false } },
        {
          ...context,
          clearShortcutCapturing: true,
        }
      ).refusal
    ).toEqual({ code: "controlUnavailable", reason: "shortcutCaptureActive" });
  });

  it("requires confirmation only for effective measurement restarts", () => {
    const unconfirmed = planSettingsUpdate(
      current,
      { dialogueVadEngine: "silero" },
      { ...context, dialogueDetectionActive: true }
    );
    expect(unconfirmed.effects).toEqual(["measurementRestart"]);
    expect(unconfirmed.confirmation).toEqual({ requiredFlag: "allowMeasurementRestart" });
    expect(
      planSettingsUpdate(
        current,
        { dialogueVadEngine: "silero" },
        { ...context, dialogueDetectionActive: true },
        { allowMeasurementRestart: true }
      ).confirmation
    ).toBeNull();
  });

  it("warns that completed FILE results need reanalysis when the VAD engine changes", () => {
    const planned = planSettingsUpdate(
      current,
      { dialogueVadEngine: "silero" },
      { ...context, hasCompletedFileAnalysis: true }
    );
    expect(planned.warnings).toContainEqual({ code: "fileReanalysisRequired" });
  });

  it("validates complete channel-role updates against the live channel count", () => {
    expect(
      planSettingsUpdate(
        current,
        { channelLabels: { channelCount: 1, mode: "custom", roles: ["M"] } },
        context
      ).refusal
    ).toEqual({ code: "channelConfigurationChanged", currentChannelCount: 2 });
    expect(
      planSettingsUpdate(
        current,
        { channelLabels: { channelCount: 2, mode: "custom", roles: ["L", "wat"] } },
        context
      ).issues
    ).toEqual([expect.objectContaining({ code: "invalidChannelRole" })]);
  });

  it("projects automatic labels and warns every FILE label change", () => {
    const custom = {
      ...current,
      channelLabels: { channelCount: 2, mode: "custom", roles: ["M", "M"] },
    };
    const auto = planSettingsUpdate(
      custom,
      { channelLabels: { channelCount: 2, mode: "auto" } },
      { ...context, sourceMode: "file" }
    );
    expect(auto.settings.channelLabels).toEqual({
      channelCount: 2,
      mode: "auto",
      roles: ["L", "R"],
    });
    expect(auto.warnings).toContainEqual({ code: "fileReanalysisRequired" });

    const relabeled = planSettingsUpdate(
      current,
      { channelLabels: { channelCount: 2, mode: "custom", roles: ["R", "L"] } },
      { ...context, sourceMode: "file" }
    );
    expect(relabeled.warnings).toContainEqual({ code: "fileReanalysisRequired" });
  });
});
