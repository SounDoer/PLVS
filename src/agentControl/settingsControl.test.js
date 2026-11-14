import { describe, expect, it } from "vitest";
import { normalizeFileSummaryMetrics } from "../lib/fileSummaryPreferences.js";
import {
  buildPublicSettings,
  buildSettingsInspection,
  buildSettingsSchema,
  planSettingsUpdate,
} from "./settingsControl.js";

const current = {
  openAtLogin: false,
  closeBehavior: "ask",
  keyboardShortcuts: {
    toggleLiveCapture: { accelerator: "CmdOrCtrl+1", global: false },
    toggleLiveSnapshot: { accelerator: "CmdOrCtrl+2", global: false },
    clear: { accelerator: "CmdOrCtrl+3", global: false },
  },
  interfaceSize: "default",
  historyRetentionSec: 3600,
  dialogueVadEngine: "firered",
  fileDialogueDetection: false,
  fileSummaryMetrics: normalizeFileSummaryMetrics(null),
  channelLabels: { channelCount: 2, mode: "auto", layout: "stereo", roles: ["L", "R"] },
};

const context = {
  autostartReady: true,
  shortcutsReady: true,
  shortcutCapturing: false,
  shortcutRegistrationErrors: {},
  dialogueDetectionActive: false,
  sourceMode: "live",
  channelAutoRoles: ["L", "R"],
};

describe("Settings Control", () => {
  it("merges File Summary Metrics with the same order and visibility rules as the toolbar", () => {
    const planned = planSettingsUpdate(
      current,
      {
        fileSummaryMetrics: {
          order: ["truePeak", "integrated"],
          visible: ["integrated", "truePeak"],
        },
      },
      context
    );
    expect(planned.changed).toEqual(["settings.fileSummaryMetrics"]);
    expect(planned.settings.fileSummaryMetrics.order.slice(0, 2)).toEqual([
      "truePeak",
      "integrated",
    ]);
    expect(planned.settings.fileSummaryMetrics.visible).toEqual(["truePeak", "integrated"]);
    expect(
      planSettingsUpdate(
        current,
        {
          fileSummaryMetrics: { visible: ["truePeak", "truePeak"], order: ["unknown"] },
        },
        context
      ).issues.map(({ path }) => path)
    ).toEqual(["$.fileSummaryMetrics.visible", "$.fileSummaryMetrics.order"]);
  });

  it("maps the application hook state into the public Settings shape", () => {
    expect(
      buildPublicSettings(
        {
          autostartEnabled: true,
          closeAction: "tray",
          keyboardShortcuts: {
            ...current.keyboardShortcuts,
            clear: { accelerator: "CmdOrCtrl+L", global: true },
          },
          interfaceSize: "large",
          historyRetentionSec: 7200,
          dialogueVadEngine: "silero",
        },
        { channelCount: 2, channelLabelMode: "custom", channelLabelRoles: ["L", "R"] }
      )
    ).toEqual({
      openAtLogin: true,
      closeBehavior: "tray",
      keyboardShortcuts: {
        ...current.keyboardShortcuts,
        clear: { accelerator: "CmdOrCtrl+L", global: true },
      },
      interfaceSize: "large",
      historyRetentionSec: 7200,
      dialogueVadEngine: "silero",
      fileDialogueDetection: false,
      fileSummaryMetrics: normalizeFileSummaryMetrics(null),
      updates: null,
      askToSendCrashReports: false,
      channelLabels: {
        channelCount: 2,
        mode: "custom",
        layout: "stereo",
        roles: ["L", "R"],
      },
    });
  });

  it("never exposes the Agent Control toggle to agents", () => {
    const publicSettings = buildPublicSettings(
      { agentControlEnabled: true, referenceLufs: -23 },
      { channelCount: 2, channelLabelMode: "custom", channelLabelRoles: ["L", "R"] }
    );
    expect(publicSettings).not.toHaveProperty("agentControlEnabled");
  });

  it("describes dynamic Channel Role options without Appearance", () => {
    const schema = buildSettingsSchema(current, context);
    expect(schema).not.toHaveProperty("appearance");
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

  it("reads the derived layout and writes roles from a layout", () => {
    const roles = ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs", "Ltf", "Rtf", "Ltr", "Rtr"];
    const settings = buildPublicSettings(current, {
      channelCount: 12,
      channelLabelMode: "custom",
      channelLabelRoles: roles,
    });
    expect(settings.channelLabels.layout).toBe("7.1.4");

    const tenChannelSettings = buildPublicSettings(current, {
      channelCount: 10,
      channelLabelMode: "custom",
      channelLabelRoles: ["L", "R", "C", "LFE", "Lb", "Rb", "Ls", "Rs", "Ltf", "Rtf"],
    });
    const applied = planSettingsUpdate(
      tenChannelSettings,
      { channelLabels: { channelCount: 10, mode: "custom", layout: "5.1.4" } },
      { ...context, channelAutoRoles: tenChannelSettings.channelLabels.roles }
    );
    expect(applied.issues).toEqual([]);
    expect(applied.settings.channelLabels.roles).toEqual([
      "L",
      "R",
      "C",
      "LFE",
      "Ls",
      "Rs",
      "Ltf",
      "Rtf",
      "Ltr",
      "Rtr",
    ]);
  });

  it("refuses a patch that sets both layout and roles", () => {
    const applied = planSettingsUpdate(
      current,
      {
        channelLabels: {
          channelCount: 2,
          mode: "custom",
          layout: "stereo",
          roles: ["L", "R"],
        },
      },
      context
    );
    expect(applied.issues.map((item) => item.path)).toContain("$.channelLabels.layout");
  });

  it("refuses a layout whose channel count does not match", () => {
    const applied = planSettingsUpdate(
      { ...current, channelLabels: { ...current.channelLabels, channelCount: 12 } },
      { channelLabels: { channelCount: 12, mode: "custom", layout: "5.1" } },
      context
    );
    expect(applied.issues.map((item) => item.code)).toContain("invalidOption");
  });

  it("separates configured settings from runtime and availability", () => {
    expect(buildSettingsInspection(current, context)).toEqual({
      settings: current,
      runtime: {
        keyboardShortcuts: {
          toggleLiveCapture: { globalRegistration: "notRequested" },
          toggleLiveSnapshot: { globalRegistration: "notRequested" },
          clear: { globalRegistration: "notRequested" },
        },
        dialogueDetection: { requested: false, active: false, engine: null },
      },
      availability: {
        openAtLogin: { writable: true, reason: null },
        keyboardShortcuts: { writable: true, reason: null },
        channelLabels: { writable: true, reason: null },
        updates: { writable: false, reason: "updatesUnavailable", autoDownloadWritable: false },
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
        keyboardShortcuts: { clear: { accelerator: "K" } },
        unknown: true,
      },
      context
    );
    expect(planned.changed).toEqual([]);
    expect(planned.issues.map(({ code }) => code)).toEqual([
      "unknownControl",
      "unknownControl",
      "invalidOption",
      "invalidShortcut",
      "invalidOption",
      "invalidOption",
      "invalidOption",
    ]);
  });

  it("merge-patches nested values and reports reduction warnings", () => {
    const planned = planSettingsUpdate(
      current,
      {
        closeBehavior: "tray",
        keyboardShortcuts: { clear: { global: true } },
        historyRetentionSec: 1800,
      },
      context
    );
    expect(planned.issues).toEqual([]);
    expect(planned.settings).toMatchObject({
      closeBehavior: "tray",
      keyboardShortcuts: {
        clear: { accelerator: "CmdOrCtrl+3", global: true },
      },
      historyRetentionSec: 1800,
    });
    expect(planned.changed).toEqual([
      "settings.closeBehavior",
      "settings.keyboardShortcuts.clear.global",
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

  it("supports removal and rejects duplicate or unknown shortcut actions atomically", () => {
    const removed = planSettingsUpdate(
      current,
      { keyboardShortcuts: { clear: { accelerator: null, global: true } } },
      context
    );
    expect(removed.issues).toEqual([]);
    expect(removed.settings.keyboardShortcuts.clear).toEqual({
      accelerator: null,
      global: false,
    });

    const invalid = planSettingsUpdate(
      current,
      {
        keyboardShortcuts: {
          toggleLiveSnapshot: { accelerator: "CmdOrCtrl+3" },
          futureAction: { accelerator: "CmdOrCtrl+J" },
        },
      },
      context
    );
    expect(invalid.changed).toEqual([]);
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unknownControl",
          path: "$.keyboardShortcuts.futureAction",
        }),
        expect.objectContaining({ code: "invalidShortcut" }),
      ])
    );
  });

  it("rejects Appearance as an unknown control and still refuses shortcut capture", () => {
    expect(planSettingsUpdate(current, { appearance: { mode: "system" } }, context).issues).toEqual(
      [expect.objectContaining({ code: "unknownControl", path: "$.appearance" })]
    );
    expect(
      planSettingsUpdate(
        current,
        { keyboardShortcuts: { clear: { global: false } } },
        {
          ...context,
          shortcutCapturing: true,
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

  it("treats a Live History Length change as a confirmed measurement restart", () => {
    const unconfirmed = planSettingsUpdate(
      current,
      { historyRetentionSec: 7200 },
      { ...context, sourceMode: "live" }
    );
    expect(unconfirmed.effects).toEqual(["measurementRestart"]);
    expect(unconfirmed.confirmation).toEqual({ requiredFlag: "allowMeasurementRestart" });

    const file = planSettingsUpdate(
      current,
      { historyRetentionSec: 7200 },
      { ...context, sourceMode: "file" }
    );
    expect(file.effects).toEqual([]);
    expect(file.confirmation).toBeNull();
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
      layout: "stereo",
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

  describe("update and crash-report preferences", () => {
    const context = {
      autostartReady: true,
      updatesAvailable: true,
      updateInstallationSupported: true,
      askToSendCrashReports: true,
      channelCount: 2,
      channelLabelMode: "auto",
      channelLabelRoles: ["L", "R"],
      channelAutoRoles: ["L", "R"],
    };
    const current = (updatePreferences, overrides = {}) =>
      buildPublicSettings(
        {
          closeAction: "tray",
          keyboardShortcuts: {},
          updatePreferences: { choiceMade: true, ...updatePreferences },
        },
        { ...context, ...overrides }
      );

    it("turns Auto Download off with Auto Check, as Settings does", () => {
      const planned = planSettingsUpdate(
        current({ autoCheck: true, autoDownload: true }),
        { updates: { autoCheck: false } },
        context
      );
      expect(planned.issues).toEqual([]);
      expect(planned.settings.updates).toEqual({ autoCheck: false, autoDownload: false });
      expect(planned.changed).toEqual(["settings.updates"]);
    });

    it("rejects Auto Download without Auto Check", () => {
      const planned = planSettingsUpdate(
        current({ autoCheck: false, autoDownload: false }),
        { updates: { autoDownload: true } },
        context
      );
      expect(planned.issues).toMatchObject([
        { code: "invalidCombination", path: "$.updates.autoDownload" },
      ]);
    });

    it("refuses update preferences where this workbench does not own them", () => {
      const planned = planSettingsUpdate(
        current({}, { updatesAvailable: false }),
        { updates: { autoCheck: true } },
        { ...context, updatesAvailable: false }
      );
      expect(planned.refusal).toEqual({ code: "controlUnavailable", reason: "updatesUnavailable" });
    });

    it("refuses Auto Download on a copy that cannot stage updates", () => {
      const planned = planSettingsUpdate(
        current({ autoCheck: true, autoDownload: false }),
        { updates: { autoDownload: true } },
        { ...context, updateInstallationSupported: false }
      );
      expect(planned.refusal).toEqual({
        code: "controlUnavailable",
        reason: "updateInstallationUnsupported",
      });
    });

    it("changes the Crash Report Prompt", () => {
      const planned = planSettingsUpdate(
        current({ autoCheck: true }),
        { askToSendCrashReports: false },
        context
      );
      expect(planned.settings.askToSendCrashReports).toBe(false);
      expect(planned.changed).toEqual(["settings.askToSendCrashReports"]);
    });
  });
});
