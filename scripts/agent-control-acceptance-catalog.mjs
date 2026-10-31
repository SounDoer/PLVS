import manifest from "../src/agentControl/commandManifest.json" with { type: "json" };

export const ACCEPTANCE_DISPOSITIONS = Object.freeze([
  "offline",
  "query",
  "roundTrip",
  "platformContract",
  "external",
]);

const groups = [
  {
    scenario: "offline-contract",
    disposition: "offline",
    commands: ["instances.list", "doctor", "schema.list", "schema.get", "completion"],
  },
  {
    scenario: "base-smoke",
    disposition: "roundTrip",
    commands: [
      "app.capabilities",
      "app.inspect",
      "ui.inspect",
      "ui.show.settings",
      "ui.close",
      "visual.describe",
      "visual.screenshot",
      "visual.recording.start",
      "visual.recording.inspect",
      "visual.recording.wait",
      "visual.recording.stop",
    ],
  },
  {
    scenario: "read-contract",
    disposition: "query",
    commands: [
      "window.inspect",
      "measurement.describe",
      "measurement.inspect",
      "view.describe",
      "view.inspect",
      "module.list",
      "module.describe",
      "axis.describe",
      "axis.inspect",
      "panel.describe",
      "preset.list",
      "preset.describe",
      "preset.export",
      "theme.list",
      "theme.inspect",
      "theme.describe",
      "theme.export",
      "loudnessProfile.list",
      "loudnessProfile.describe",
      "loudnessProfile.export",
      "config.export",
      "settings.describe",
      "settings.inspect",
      "device.list",
      "device.inspect",
      "transport.inspect",
      "transport.file.report",
      "editorDraft.describe",
      "editorDraft.inspect",
    ],
  },
  {
    scenario: "scene-round-trip",
    disposition: "roundTrip",
    commands: [
      "view.update",
      "view.reset",
      "workspace.applyLayout",
      "axis.shared.update",
      "axis.shared.reset",
      "axis.panel.update",
      "axis.panel.reset",
      "panel.update",
      "panel.reset",
      "settings.update",
    ],
  },
  {
    scenario: "preset-round-trip",
    disposition: "roundTrip",
    commands: [
      "preset.rename",
      "preset.delete",
      "preset.reorder",
      "preset.save",
      "preset.update",
      "preset.apply",
      "preset.import",
    ],
  },
  {
    scenario: "theme-round-trip",
    disposition: "roundTrip",
    commands: [
      "theme.select",
      "theme.followSystem",
      "theme.create",
      "theme.update",
      "theme.rename",
      "theme.duplicate",
      "theme.delete",
      "theme.reorder",
      "theme.import",
    ],
  },
  {
    scenario: "loudness-profile-round-trip",
    disposition: "roundTrip",
    commands: [
      "loudnessProfile.select",
      "loudnessProfile.create",
      "loudnessProfile.update",
      "loudnessProfile.rename",
      "loudnessProfile.delete",
      "loudnessProfile.reorder",
      "loudnessProfile.import",
    ],
  },
  {
    scenario: "file-transport-round-trip",
    disposition: "roundTrip",
    commands: [
      "transport.source.live",
      "transport.source.file",
      "transport.file.analyze",
      "transport.file.reanalyze",
      "transport.file.stop",
      "transport.file.select",
      "transport.file.remove",
      "transport.file.clear",
    ],
  },
  {
    scenario: "semantic-ui-round-trip",
    disposition: "roundTrip",
    commands: [
      "ui.show.panelSettings",
      "ui.show.themeEditor",
      "ui.show.loudnessProfileEditor",
      "ui.show.feedback",
      "ui.show.toolbarMenu",
      "ui.cancel",
      "editorDraft.patch",
      "editorDraft.undo",
      "editorDraft.redo",
      "editorDraft.save",
      "editorDraft.discard",
    ],
  },
  {
    scenario: "dock-platform-contract",
    disposition: "platformContract",
    commands: [
      "dock.describe",
      "dock.inspect",
      "dock.enter",
      "dock.exit",
      "dock.layout.apply",
      "dock.panel.describe",
      "dock.panel.update",
      "dock.panel.reset",
      "ui.show.dockToolbar",
    ],
  },
  {
    scenario: "window-platform-contract",
    disposition: "platformContract",
    commands: ["window.resize", "window.hide", "window.show"],
  },
  {
    scenario: "capture-rig",
    disposition: "external",
    commands: [
      "measurement.wait",
      "measurement.waitUntil",
      "device.select",
      "transport.live.start",
      "transport.live.stop",
      "transport.live.clear",
      "transport.snapshot.select",
      "transport.snapshot.clear",
    ],
    owner: "capture",
  },
  {
    scenario: "revision-wait",
    disposition: "roundTrip",
    commands: ["app.wait"],
  },
  {
    scenario: "configuration-relaunch",
    disposition: "external",
    commands: ["config.import"],
    owner: "update",
  },
];

export function buildAgentControlAcceptanceCatalog(commandManifest = manifest) {
  const byId = new Map();
  for (const group of groups) {
    for (const commandId of group.commands) {
      if (byId.has(commandId)) throw new Error(`Duplicate acceptance command: ${commandId}`);
      byId.set(commandId, {
        commandId,
        scenario: group.scenario,
        disposition: group.disposition,
        ...(group.owner ? { owner: group.owner } : {}),
      });
    }
  }
  const manifestIds = commandManifest.commands.map(({ id }) => id);
  const missing = manifestIds.filter((id) => !byId.has(id));
  const unknown = [...byId.keys()].filter((id) => !manifestIds.includes(id));
  if (missing.length || unknown.length) {
    throw new Error(
      `Agent Control acceptance catalogue mismatch: missing [${missing.join(", ")}], unknown [${unknown.join(", ")}]`
    );
  }
  return Object.freeze(manifestIds.map((id) => Object.freeze(byId.get(id))));
}

export const agentControlAcceptanceCatalog = buildAgentControlAcceptanceCatalog();

export const AGENT_CONTROL_ACCEPTANCE_SCENARIOS = Object.freeze([
  ...new Set(agentControlAcceptanceCatalog.map(({ scenario }) => scenario)),
]);
