import { settingsStore } from "../../persistence/index.js";
import { parseSelection } from "../../lib/loudnessProfileCatalog.js";
import { normalizeRuleDocument } from "../../lib/loudnessProfileNormalize.js";
import { normalizeThemeDocumentShape } from "../../theme/themeSchema.js";

export function measuredAudioState(runtime, transport) {
  if (runtime?.sourceMode === "file") return "sourceModeFile";
  if (transport?.live?.state !== "running") return "liveStopped";
  return "active";
}

export function workspaceMatches(workspace, view) {
  return (
    workspace.tree === view.tree &&
    workspace.panelsById === view.panelsById &&
    workspace.panelOrder === view.panelOrder
  );
}

export function panelControlsMatch(workspace, view, panelId) {
  return (
    JSON.stringify(workspace.panelControlsById?.[panelId]) ===
    JSON.stringify(view.panelControlsById?.[panelId])
  );
}

export function axisStateMatches(workspace, view) {
  return (
    JSON.stringify(workspace.axisViewports) === JSON.stringify(view.axisViewports) &&
    JSON.stringify(workspace.panelControlsById) === JSON.stringify(view.panelControlsById)
  );
}

export function controllableWorkspaceMatches(left, right) {
  return (
    left.tree === right.tree &&
    left.panelsById === right.panelsById &&
    left.panelOrder === right.panelOrder &&
    left.panelControlsById === right.panelControlsById &&
    left.pinnedPanelsById === right.pinnedPanelsById &&
    left.axisViewports === right.axisViewports
  );
}

export function presetStateSignature(presets) {
  return JSON.stringify({
    list: Array.isArray(presets?.list) ? presets.list : [],
    activeId: typeof presets?.activeId === "string" ? presets.activeId : null,
    dirty: presets?.dirty === true,
  });
}

export function themeStateSignature(state) {
  return JSON.stringify({
    appearance: {
      mode: state?.appearance?.mode,
      selectedThemeId:
        state?.appearance?.mode === "fixed" ? (state.appearance.selectedThemeId ?? null) : null,
    },
    themes: (Array.isArray(state?.themes) ? state.themes : [])
      .map((theme) => normalizeThemeDocumentShape(theme))
      .filter(Boolean),
  });
}

export function loudnessProfileStateSignature(profiles, activeSelection) {
  const normalizedProfiles = (Array.isArray(profiles) ? profiles : [])
    .map((profile) => normalizeRuleDocument(profile))
    .filter(Boolean);
  return JSON.stringify({
    activeId: activeLoudnessProfileId(normalizedProfiles, activeSelection),
    profiles: normalizedProfiles,
  });
}

/// The live Loudness Profile selection, as `loudnessProfile.list` reports it. Off is null, and so
/// is a selection pointing at a profile the library no longer holds.
///
/// Read from `plvs:settings` rather than a prop: the bridge is handed the profile *library*
/// (`loudnessProfiles`) and never the selection, and `LoudnessProfileContext` writes every
/// selection change straight through to that store. It is also where the loudness adapter reads
/// the library from, so both halves of this result come from one source.
export function activeLoudnessProfileId(
  profiles,
  selection = settingsStore.read().loudnessProfiles?.active
) {
  const { id } = parseSelection(selection);
  return id !== null && profiles.some((profile) => profile.id === id) ? id : null;
}

/// Compares the live Workspace against the view a Preset becomes once applied.
///
/// Never compare against the stored Preset itself: applying migrates its controls, so a Preset
/// saved before a control was added or removed can never equal the Workspace it produces, and a
/// settlement waiting on that equality would never fire.
export function workspaceMatchesPresetView(workspace, view) {
  return [
    "tree",
    "panelsById",
    "panelOrder",
    "panelControlsById",
    "pinnedPanelsById",
    "axisViewports",
  ].every((key) => JSON.stringify(workspace[key]) === JSON.stringify(view[key]));
}

function settingsStateForSignature(settings) {
  if (!settings) return null;
  return {
    ...settings,
    channelLabels: {
      mode: settings.channelLabels?.mode,
      ...(settings.channelLabels?.mode === "custom" ? { roles: settings.channelLabels.roles } : {}),
    },
  };
}

export function settingsStateSignature(settings) {
  return JSON.stringify(settingsStateForSignature(settings));
}

export function ordinarySettingsStateSignature(settings) {
  const normalized = settingsStateForSignature(settings);
  if (normalized === null) return "null";
  const {
    openAtLogin: _openAtLogin,
    keyboardShortcuts: _keyboardShortcuts,
    ...ordinary
  } = normalized;
  return JSON.stringify(ordinary);
}

export function requestedDeviceSignature(device) {
  return device?.snapshot?.requestedId === undefined ? "default" : device.snapshot.requestedId;
}
