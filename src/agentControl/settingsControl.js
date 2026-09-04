import { reservedComboConflict } from "../data/keyboardShortcuts.js";
import { isValidAccelerator } from "../lib/accelerator.js";
import { CHANNEL_ROLE_VOCABULARY, roleTokensToLoudnessWeights } from "../math/channelRoles.js";

const PUBLIC_FIELDS = [
  "openAtLogin",
  "closeBehavior",
  "clearShortcut",
  "interfaceSize",
  "appearance",
  "historyRetentionSec",
  "dialogueVadEngine",
  "channelLabels",
];
const CLOSE_BEHAVIORS = ["ask", "tray", "quit"];
const INTERFACE_SIZES = ["small", "default", "large", "extra-large"];
const HISTORY_LENGTHS = [1800, 3600, 7200, 14400];
const VAD_ENGINES = ["firered", "silero", "ten"];
const CHANNEL_ROLES = new Set(CHANNEL_ROLE_VOCABULARY.map(({ id }) => id));

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function issue(code, path, message) {
  return { code, path, message };
}

function changedValue(changed, path, before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) changed.push(path);
}

export function buildPublicSettings(settings, context) {
  return {
    openAtLogin: context.autostartReady === false ? null : settings.autostartEnabled === true,
    closeBehavior: settings.closeAction,
    clearShortcut: {
      accelerator: settings.clearShortcut,
      global: settings.clearGlobal === true,
    },
    interfaceSize: settings.interfaceSize,
    appearance: {
      mode: settings.appearance,
      themeId: settings.appearance === "system" ? null : settings.themeId,
      resolvedThemeId: settings.resolvedThemeId,
    },
    historyRetentionSec: settings.historyRetentionSec,
    dialogueVadEngine: settings.dialogueVadEngine,
    channelLabels: {
      channelCount: context.channelCount,
      mode: context.channelLabelMode,
      roles: [...context.channelLabelRoles],
    },
  };
}

export function buildSettingsSchema(settings, context) {
  const inspection = buildSettingsInspection(settings, context);
  return {
    openAtLogin: {
      type: "boolean",
      default: false,
      current: settings.openAtLogin,
      availability: inspection.availability.openAtLogin,
    },
    closeBehavior: {
      type: "enum",
      default: "ask",
      current: settings.closeBehavior,
      options: CLOSE_BEHAVIORS,
    },
    clearShortcut: {
      type: "object",
      properties: {
        accelerator: {
          type: "accelerator",
          default: "CmdOrCtrl+K",
          current: settings.clearShortcut.accelerator,
        },
        global: { type: "boolean", default: false, current: settings.clearShortcut.global },
      },
      availability: inspection.availability.clearShortcut,
    },
    interfaceSize: {
      type: "enum",
      default: "default",
      current: settings.interfaceSize,
      options: INTERFACE_SIZES,
    },
    appearance: {
      type: "object",
      properties: {
        mode: {
          type: "enum",
          default: "system",
          current: settings.appearance.mode,
          options: ["system", "fixed"],
        },
        themeId: {
          type: "enum",
          default: null,
          current: settings.appearance.themeId,
          options: context.themeOptions,
          nullable: true,
        },
        resolvedThemeId: {
          type: "string",
          current: settings.appearance.resolvedThemeId,
          writable: false,
        },
      },
      availability: inspection.availability.appearance,
    },
    historyRetentionSec: {
      type: "enum",
      default: 3600,
      current: settings.historyRetentionSec,
      options: HISTORY_LENGTHS,
      unit: "s",
    },
    dialogueVadEngine: {
      type: "enum",
      default: "firered",
      current: settings.dialogueVadEngine,
      options: VAD_ENGINES,
    },
    channelLabels: {
      type: "object",
      properties: {
        channelCount: { type: "integer", current: settings.channelLabels.channelCount },
        mode: { type: "enum", current: settings.channelLabels.mode, options: ["auto", "custom"] },
        roles: {
          type: "array",
          current: settings.channelLabels.roles,
          items: {
            type: "enum",
            options: CHANNEL_ROLE_VOCABULARY.map(({ id, label }) => ({ id, name: label })),
          },
        },
      },
      availability: inspection.availability.channelLabels,
    },
  };
}

export function buildSettingsInspection(settings, context) {
  const autostartWritable = context.autostartReady === true;
  const shortcutWritable = context.clearShortcutCapturing !== true;
  const appearanceWritable = !context.activeEditors?.includes("theme");
  const channelWritable = settings.channelLabels.channelCount > 0;
  return {
    settings,
    runtime: {
      clearShortcut: {
        globalRegistration: !settings.clearShortcut.global
          ? "notRequested"
          : context.clearShortcutReady !== true || context.clearShortcutRegistrationError
            ? "unavailable"
            : "active",
      },
      dialogueDetection: {
        requested:
          context.dialogueDetectionRequested === true || context.dialogueDetectionActive === true,
        active: context.dialogueDetectionActive === true,
        engine: context.dialogueDetectionActive === true ? settings.dialogueVadEngine : null,
      },
    },
    availability: {
      openAtLogin: {
        writable: autostartWritable,
        reason: autostartWritable ? null : "autostartUnavailable",
      },
      clearShortcut: {
        writable: shortcutWritable,
        reason: shortcutWritable ? null : "shortcutCaptureActive",
      },
      appearance: {
        writable: appearanceWritable,
        reason: appearanceWritable ? null : "editorActive",
      },
      channelLabels: {
        writable: channelWritable,
        reason: channelWritable ? null : "noChannels",
      },
    },
  };
}

export function planSettingsUpdate(current, patch, context, options = {}) {
  const issues = [];
  const unknown = Object.keys(patch).filter((key) => !PUBLIC_FIELDS.includes(key));
  for (const key of unknown) {
    issues.push(issue("unknownControl", `$.${key}`, `Unknown Settings control: ${key}.`));
  }

  if ("openAtLogin" in patch && typeof patch.openAtLogin !== "boolean") {
    issues.push(issue("invalidType", "$.openAtLogin", "openAtLogin must be a boolean."));
  }
  if ("closeBehavior" in patch && !CLOSE_BEHAVIORS.includes(patch.closeBehavior)) {
    issues.push(issue("invalidOption", "$.closeBehavior", "closeBehavior is not supported."));
  }

  let nextShortcut = current.clearShortcut;
  if ("clearShortcut" in patch) {
    if (!isObject(patch.clearShortcut)) {
      issues.push(issue("invalidType", "$.clearShortcut", "clearShortcut must be an object."));
    } else {
      for (const key of Object.keys(patch.clearShortcut)) {
        if (!new Set(["accelerator", "global"]).has(key)) {
          issues.push(
            issue("unknownControl", `$.clearShortcut.${key}`, `Unknown shortcut control: ${key}.`)
          );
        }
      }
      nextShortcut = { ...current.clearShortcut, ...patch.clearShortcut };
      if (
        "accelerator" in patch.clearShortcut &&
        (!isValidAccelerator(patch.clearShortcut.accelerator) ||
          reservedComboConflict(patch.clearShortcut.accelerator))
      ) {
        issues.push(
          issue(
            "invalidShortcut",
            "$.clearShortcut.accelerator",
            "accelerator must be a valid, unreserved Tauri accelerator."
          )
        );
      }
      if ("global" in patch.clearShortcut && typeof patch.clearShortcut.global !== "boolean") {
        issues.push(
          issue("invalidType", "$.clearShortcut.global", "clearShortcut.global must be a boolean.")
        );
      }
    }
  }
  if ("interfaceSize" in patch && !INTERFACE_SIZES.includes(patch.interfaceSize)) {
    issues.push(issue("invalidOption", "$.interfaceSize", "interfaceSize is not supported."));
  }

  let nextAppearance = current.appearance;
  if ("appearance" in patch) {
    if (!isObject(patch.appearance)) {
      issues.push(issue("invalidType", "$.appearance", "appearance must be an object."));
    } else {
      for (const key of Object.keys(patch.appearance)) {
        if (!new Set(["mode", "themeId"]).has(key)) {
          issues.push(
            issue(
              key === "resolvedThemeId" ? "readOnlyControl" : "unknownControl",
              `$.appearance.${key}`,
              `${key} is not writable.`
            )
          );
        }
      }
      nextAppearance = { ...current.appearance, ...patch.appearance };
      if (!new Set(["system", "fixed"]).has(nextAppearance.mode)) {
        issues.push(
          issue("invalidOption", "$.appearance.mode", "appearance.mode is not supported.")
        );
      } else if (nextAppearance.mode === "system" && nextAppearance.themeId !== null) {
        issues.push(
          issue(
            "themeNotAllowed",
            "$.appearance.themeId",
            "System appearance requires themeId null."
          )
        );
      } else if (nextAppearance.mode === "fixed") {
        if (!("themeId" in patch.appearance) && current.appearance.mode !== "fixed") {
          issues.push(
            issue("themeRequired", "$.appearance.themeId", "Fixed appearance requires a themeId.")
          );
        } else if (!context.themeOptions.some(({ id }) => id === nextAppearance.themeId)) {
          issues.push(issue("themeNotFound", "$.appearance.themeId", "The Theme was not found."));
        }
      }
    }
  }
  if ("historyRetentionSec" in patch && !HISTORY_LENGTHS.includes(patch.historyRetentionSec)) {
    issues.push(
      issue("invalidOption", "$.historyRetentionSec", "historyRetentionSec is not supported.")
    );
  }
  if ("dialogueVadEngine" in patch && !VAD_ENGINES.includes(patch.dialogueVadEngine)) {
    issues.push(
      issue("invalidOption", "$.dialogueVadEngine", "dialogueVadEngine is not supported.")
    );
  }

  let nextChannelLabels = current.channelLabels;
  if ("channelLabels" in patch) {
    const value = patch.channelLabels;
    if (!isObject(value)) {
      issues.push(issue("invalidType", "$.channelLabels", "channelLabels must be an object."));
    } else {
      const allowed = new Set(["channelCount", "mode", "roles"]);
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
          issues.push(
            issue("unknownControl", `$.channelLabels.${key}`, `Unknown channel control: ${key}.`)
          );
        }
      }
      if (!Number.isInteger(value.channelCount) || value.channelCount < 0) {
        issues.push(
          issue("invalidChannelCount", "$.channelLabels.channelCount", "channelCount is invalid.")
        );
      }
      if (!new Set(["auto", "custom"]).has(value.mode)) {
        issues.push(
          issue("invalidOption", "$.channelLabels.mode", "channelLabels.mode is invalid.")
        );
      } else if (value.mode === "auto" && "roles" in value) {
        issues.push(
          issue("rolesNotAllowed", "$.channelLabels.roles", "Automatic labels must omit roles.")
        );
      } else if (
        value.mode === "custom" &&
        (!Array.isArray(value.roles) || value.roles.length !== value.channelCount)
      ) {
        issues.push(
          issue(
            "invalidRoles",
            "$.channelLabels.roles",
            "Custom labels require one role per channel."
          )
        );
      } else if (value.mode === "custom" && !value.roles.every((role) => CHANNEL_ROLES.has(role))) {
        issues.push(
          issue("invalidChannelRole", "$.channelLabels.roles", "A channel role is not supported.")
        );
      }
      nextChannelLabels = {
        channelCount: value.channelCount,
        mode: value.mode,
        roles: value.mode === "custom" ? value.roles : current.channelLabels.roles,
      };
    }
  }

  if (issues.length > 0) {
    return { settings: current, changed: [], effects: [], warnings: [], issues, refusal: null };
  }
  if ("appearance" in patch && context.activeEditors?.includes("theme")) {
    return {
      settings: current,
      changed: [],
      effects: [],
      warnings: [],
      issues: [],
      refusal: { code: "editorActive", editors: ["theme"] },
    };
  }
  if ("openAtLogin" in patch && context.autostartReady !== true) {
    return {
      settings: current,
      changed: [],
      effects: [],
      warnings: [],
      issues: [],
      refusal: { code: "controlUnavailable", reason: "autostartUnavailable" },
    };
  }
  if ("clearShortcut" in patch && context.clearShortcutCapturing === true) {
    return {
      settings: current,
      changed: [],
      effects: [],
      warnings: [],
      issues: [],
      refusal: { code: "controlUnavailable", reason: "shortcutCaptureActive" },
    };
  }
  if ("channelLabels" in patch) {
    if (current.channelLabels.channelCount === 0) {
      return {
        settings: current,
        changed: [],
        effects: [],
        warnings: [],
        issues: [],
        refusal: { code: "controlUnavailable", reason: "noChannels" },
      };
    }
    if (nextChannelLabels.channelCount !== current.channelLabels.channelCount) {
      return {
        settings: current,
        changed: [],
        effects: [],
        warnings: [],
        issues: [],
        refusal: {
          code: "channelConfigurationChanged",
          currentChannelCount: current.channelLabels.channelCount,
        },
      };
    }
  }

  const settings = {
    ...current,
    ...(Object.hasOwn(patch, "openAtLogin") ? { openAtLogin: patch.openAtLogin } : {}),
    ...(Object.hasOwn(patch, "closeBehavior") ? { closeBehavior: patch.closeBehavior } : {}),
    ...(Object.hasOwn(patch, "clearShortcut") ? { clearShortcut: nextShortcut } : {}),
    ...(Object.hasOwn(patch, "interfaceSize") ? { interfaceSize: patch.interfaceSize } : {}),
    ...(Object.hasOwn(patch, "appearance")
      ? {
          appearance: {
            ...nextAppearance,
            resolvedThemeId:
              nextAppearance.mode === "fixed"
                ? nextAppearance.themeId
                : current.appearance.resolvedThemeId,
          },
        }
      : {}),
    ...(Object.hasOwn(patch, "historyRetentionSec")
      ? { historyRetentionSec: patch.historyRetentionSec }
      : {}),
    ...(Object.hasOwn(patch, "dialogueVadEngine")
      ? { dialogueVadEngine: patch.dialogueVadEngine }
      : {}),
    ...(Object.hasOwn(patch, "channelLabels") ? { channelLabels: nextChannelLabels } : {}),
  };
  const changed = [];
  changedValue(changed, "settings.openAtLogin", current.openAtLogin, settings.openAtLogin);
  changedValue(changed, "settings.closeBehavior", current.closeBehavior, settings.closeBehavior);
  changedValue(
    changed,
    "settings.clearShortcut.accelerator",
    current.clearShortcut.accelerator,
    settings.clearShortcut.accelerator
  );
  changedValue(
    changed,
    "settings.clearShortcut.global",
    current.clearShortcut.global,
    settings.clearShortcut.global
  );
  changedValue(changed, "settings.interfaceSize", current.interfaceSize, settings.interfaceSize);
  changedValue(
    changed,
    "settings.appearance.mode",
    current.appearance.mode,
    settings.appearance.mode
  );
  changedValue(
    changed,
    "settings.appearance.themeId",
    current.appearance.themeId,
    settings.appearance.themeId
  );
  changedValue(
    changed,
    "settings.historyRetentionSec",
    current.historyRetentionSec,
    settings.historyRetentionSec
  );
  changedValue(
    changed,
    "settings.dialogueVadEngine",
    current.dialogueVadEngine,
    settings.dialogueVadEngine
  );
  changedValue(changed, "settings.channelLabels", current.channelLabels, settings.channelLabels);

  const effects = [];
  if (changed.includes("settings.dialogueVadEngine") && context.dialogueDetectionActive === true) {
    effects.push("measurementRestart");
  }
  if (changed.includes("settings.channelLabels")) {
    const weightsChanged =
      JSON.stringify(roleTokensToLoudnessWeights(current.channelLabels.roles)) !==
      JSON.stringify(roleTokensToLoudnessWeights(settings.channelLabels.roles));
    if (weightsChanged && context.sourceMode === "live") effects.push("loudnessMeasurementRestart");
  }
  const requiresRestart = effects.some((effect) => effect.endsWith("Restart"));
  const confirmation =
    requiresRestart && options.allowMeasurementRestart !== true
      ? { requiredFlag: "allowMeasurementRestart" }
      : null;
  const warnings = [];
  if (settings.historyRetentionSec < current.historyRetentionSec) {
    warnings.push({
      code: "historyRetentionReduced",
      previous: current.historyRetentionSec,
      target: settings.historyRetentionSec,
    });
  }
  if (
    changed.includes("settings.channelLabels") &&
    context.sourceMode === "file" &&
    current.channelLabels.mode !== settings.channelLabels.mode
  ) {
    warnings.push({ code: "fileReanalysisRequired" });
  }
  return { settings, changed, effects, warnings, issues: [], refusal: null, confirmation };
}
