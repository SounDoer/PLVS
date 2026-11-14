/**
 * Every user-operable Settings control and public File preference have explicit owners.
 * Settings Control exposes entries owned by `settings`. Other owners point to their existing
 * command family or record why an agent must not operate the control.
 */
export const SETTINGS_SURFACE_CONTROLS = Object.freeze([
  { id: "behavior.openAtLogin", owner: "settings", field: "openAtLogin" },
  { id: "behavior.closeBehavior", owner: "settings", field: "closeBehavior" },
  { id: "shortcuts.startStopAccelerator", owner: "settings", field: "keyboardShortcuts" },
  { id: "shortcuts.startStopReset", owner: "settings", field: "keyboardShortcuts" },
  { id: "shortcuts.startStopGlobal", owner: "settings", field: "keyboardShortcuts" },
  { id: "shortcuts.snapshotAccelerator", owner: "settings", field: "keyboardShortcuts" },
  { id: "shortcuts.snapshotReset", owner: "settings", field: "keyboardShortcuts" },
  { id: "shortcuts.snapshotGlobal", owner: "settings", field: "keyboardShortcuts" },
  { id: "shortcuts.clearAccelerator", owner: "settings", field: "keyboardShortcuts" },
  { id: "shortcuts.clearAcceleratorReset", owner: "settings", field: "keyboardShortcuts" },
  { id: "shortcuts.clearGlobal", owner: "settings", field: "keyboardShortcuts" },
  { id: "appearance.interfaceSize", owner: "settings", field: "interfaceSize" },
  { id: "appearance.mode", owner: "theme" },
  { id: "appearance.theme", owner: "theme" },
  { id: "appearance.browseThemes", owner: "external" },
  { id: "analysis.historyRetention", owner: "settings", field: "historyRetentionSec" },
  { id: "analysis.dialogueVadEngine", owner: "settings", field: "dialogueVadEngine" },
  { id: "file.dialogueDetection", owner: "settings", field: "fileDialogueDetection" },
  { id: "file.summaryMetrics", owner: "settings", field: "fileSummaryMetrics" },
  { id: "analysis.dialogueVadDocumentation", owner: "external" },
  { id: "channels.resetLabels", owner: "settings", field: "channelLabels" },
  { id: "channels.layout", owner: "settings", field: "channelLabels" },
  { id: "channels.role", owner: "settings", field: "channelLabels", repeated: true },
  { id: "transfer.libraryExport", owner: "library" },
  { id: "transfer.libraryImport", owner: "library" },
  { id: "transfer.configurationExport", owner: "configuration" },
  { id: "transfer.configurationImport", owner: "configuration" },
  { id: "transfer.configurationReset", owner: "userOnly", reason: "destructiveRelaunch" },
  { id: "agentControl.enabled", owner: "userOnly", reason: "permissionBoundary" },
  { id: "updates.autoCheck", owner: "settings", field: "updates" },
  { id: "updates.autoDownload", owner: "settings", field: "updates" },
  { id: "updates.askToSendCrashReports", owner: "settings", field: "askToSendCrashReports" },
  { id: "about.checkForUpdates", owner: "update" },
  { id: "about.installUpdate", owner: "update" },
  { id: "about.sharesets", owner: "external" },
  { id: "about.releases", owner: "external" },
  { id: "about.documentation", owner: "external" },
  { id: "about.feedback", owner: "ui" },
]);

export const SETTINGS_CONTROL_OWNERS = Object.freeze([
  "settings",
  "theme",
  "library",
  "configuration",
  "update",
  "ui",
  "external",
  "userOnly",
]);

export const PUBLIC_SETTINGS_FIELDS = Object.freeze([
  ...new Set(
    SETTINGS_SURFACE_CONTROLS.filter(({ owner }) => owner === "settings").map(({ field }) => field)
  ),
]);

export function settingsSurfaceControl(id) {
  const control = SETTINGS_SURFACE_CONTROLS.find((candidate) => candidate.id === id);
  if (!control) throw new Error(`Unknown Settings surface control: ${id}`);
  return control;
}
