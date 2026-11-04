// Only these existing business callbacks may cross the Settings presentation boundary.
export const SETTINGS_ACTIONS = Object.freeze({
  settings: [
    "setSettingsOpen",
    "setAppearanceMode",
    "setInterfaceSize",
    "setFixedThemeIdFromPicker",
    "setChannelLayout",
    "setChannelLabelToken",
    "resetChannelLabels",
    "onCheckForUpdate",
    "onInstallUpdate",
    "setUpdatePreferences",
    "openExternalUrl",
    "setAutostartEnabled",
    "setCloseAction",
    "setHistoryRetentionSec",
    "setDialogueVadEngine",
    "setShortcutAccelerator",
    "setShortcutGlobal",
    "setShortcutCapturing",
    "createCustomTheme",
    "editCustomTheme",
    "customizeBuiltinTheme",
    "duplicateCustomTheme",
    "deleteCustomTheme",
    "onExportTheme",
    "onExportConfiguration",
    "onImportConfiguration",
    "onResetConfiguration",
    "onLibraryExport",
    "onSharedPackImport",
    "onSetAgentControlEnabled",
    "onAskToSendCrashReports",
    "onOpenFeedback",
    "onOpenQuickTour",
  ],
  libraryExport: ["onExport", "onClose"],
  theme: [
    "onName",
    "onColorScheme",
    "onCore",
    "onResetCore",
    "onPaletteColor",
    "onIntensityStop",
    "onIntensityStops",
    "onApplyPreset",
    "onOverride",
    "onResetOverrides",
    "onUndo",
    "onRedo",
    "onSave",
    "onCancel",
    "onDismiss",
    "onDiscardOpenChange",
    "onConfirmDiscard",
    "onPageChange",
    "onPreviewOpenChange",
    "onDelete",
  ],
  profile: [
    "onName",
    "onReference",
    "onAddRule",
    "onUpdateRule",
    "onRemoveRule",
    "onReorderRules",
    "onSave",
    "onCancel",
    "onDismiss",
    "onDiscardOpenChange",
    "onConfirmDiscard",
  ],
  feedback: [
    "setContent",
    "setEmail",
    "setEmailTouched",
    "setAttachDiagnostics",
    "setDiagnosticsPreview",
    "setShowDiagnostics",
    "setStatus",
    "previewDiagnostics",
    "handleSubmit",
    "onClose",
    "onPrivacy",
  ],
});

export function settingsViewSnapshot(view, model) {
  if (!SETTINGS_ACTIONS[view]) throw new Error("Unknown Settings view.");
  return {
    values: JSON.parse(JSON.stringify(model)),
    actions: SETTINGS_ACTIONS[view].filter((name) => typeof model[name] === "function"),
  };
}

/** Reject stale sessions and duplicate operations before entering the business callback. */
export function createSettingsDispatcher({ read, commit }) {
  let queue = Promise.resolve();
  const handled = new Map();
  return (request) => {
    const pending = queue
      .catch(() => {})
      .then(async () => {
        const current = read();
        if (current.enabled === false || !current.active || request.session !== current.session)
          throw new Error("Settings session changed. Reopen Settings and try again.");
        if (
          !Number.isSafeInteger(request.sequence) ||
          request.sequence <= (handled.get(request.session) ?? 0)
        )
          throw new Error("This Settings action was already handled.");
        if (
          !SETTINGS_ACTIONS[current.view]?.includes(request.name) ||
          typeof current.model[request.name] !== "function" ||
          !Array.isArray(request.args)
        )
          throw new Error("Unsupported Settings action.");
        handled.clear();
        handled.set(request.session, request.sequence);
        const args =
          request.name === "onUpdateRule" && request.args[1]?.value === null
            ? [request.args[0], { ...request.args[1], value: undefined }]
            : request.args;
        return commit(() => current.model[request.name](...args));
      });
    queue = pending;
    return pending;
  };
}

/** Preserve typed values until their ordered business action has been acknowledged. */
export function optimisticSettingsValue(view, model, name, args) {
  if (view === "feedback" && /^set[A-Z]/.test(name)) {
    const field = name.slice(3, 4).toLowerCase() + name.slice(4);
    return { ...model, [field]: args[0] };
  }
  if (view === "settings") {
    const fields = {
      setAppearanceMode: "appearance",
      setInterfaceSize: "interfaceSize",
      setFixedThemeIdFromPicker: "fixedThemeSelectValue",
      setAutostartEnabled: "autostartEnabled",
      setCloseAction: "closeAction",
      setHistoryRetentionSec: "historyRetentionSec",
      setDialogueVadEngine: "dialogueVadEngine",
      setUpdatePreferences: "updatePreferences",
    };
    if (fields[name]) return { ...model, [fields[name]]: args[0] };
    if (name === "setChannelLabelToken")
      return {
        ...model,
        channelLabelTokens: model.channelLabelTokens.map((token, index) =>
          index === args[0] ? args[1] : token
        ),
      };
  }
  if (view === "theme") {
    if (name === "onName") return { ...model, draft: { ...model.draft, name: args[0] } };
    if (name === "onCore")
      return {
        ...model,
        draft: { ...model.draft, core: { ...model.draft.core, [args[0]]: args[1] } },
      };
  }
  if (view === "profile" && name === "onName")
    return {
      ...model,
      draft: { ...model.draft, document: { ...model.draft.document, name: args[0] } },
    };
  return model;
}

// DOM click events are local presentation objects, never part of the wire contract.
const NO_ARGUMENT = new Set([
  "resetChannelLabels",
  "onCheckForUpdate",
  "onInstallUpdate",
  "createCustomTheme",
  "onExportConfiguration",
  "onImportConfiguration",
  "onResetConfiguration",
  "onLibraryExport",
  "onSharedPackImport",
  "onOpenFeedback",
  "onOpenQuickTour",
  "onResetCore",
  "onUndo",
  "onRedo",
  "onSave",
  "onCancel",
  "onDismiss",
  "onConfirmDiscard",
  "onDelete",
  "onClose",
  "onPrivacy",
  "handleSubmit",
]);
const TWO_ARGUMENTS = new Set([
  "setChannelLabelToken",
  "setShortcutAccelerator",
  "setShortcutGlobal",
  "onCore",
  "onIntensityStop",
  "onApplyPreset",
  "onOverride",
  "onUpdateRule",
  "onExport",
]);
export function settingsActionArguments(name, args) {
  const selected = args.slice(
    0,
    NO_ARGUMENT.has(name) ? 0 : TWO_ARGUMENTS.has(name) ? 2 : name === "onPaletteColor" ? 3 : 1
  );
  // JSON omits undefined properties. A blank Profile threshold must still explicitly clear
  // the old value when it reaches the shared business function.
  if (
    name === "onUpdateRule" &&
    selected[1] &&
    Object.hasOwn(selected[1], "value") &&
    selected[1].value === undefined
  ) {
    return [selected[0], { ...selected[1], value: null }];
  }
  return selected;
}
