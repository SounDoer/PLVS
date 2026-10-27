import { normalizePanelControls } from "../lib/panelControls.js";
import { clampSpectrumChannelToAvailable } from "../math/spectrumChannelOptions.js";
import { clampVectorscopePairToAvailable } from "../math/vectorscopePairMath.js";
import { resolvePanelModuleId } from "../workspace/panelInstances.js";

/**
 * What the current source offers, as the analysis session derives it.
 * @typedef {{
 *   channelCount?: number,
 *   spectrumChannelOptions?: import("../math/spectrumChannelOptions.js").SpectrumChannelOption[],
 *   peakLabelContext?: import("../math/peakMeterChannelLabels.js").PeakMeterChannelLabelsContext,
 * }} ChannelTopology
 */

/// Workspace and Dock name the same modules differently.
const CHANNEL_FIELD_BY_MODULE_ID = {
  spectrum: "spectrumChannel",
  spectrogram: "spectrumChannel",
  vectorscope: "vectorscopePair",
  correlation: "vectorscopePair",
  "stereo-map": "stereoMapPair",
  stereoMap: "stereoMapPair",
};

/** @param {ChannelTopology | undefined} topology */
export function channelTopologyKnown(topology) {
  return Number.isInteger(topology?.channelCount) && topology.channelCount > 0;
}

function selectionKey(selection) {
  if (selection?.type === "single") return `s-${selection.ch}`;
  return `p-${selection?.x}-${selection?.y}`;
}

/**
 * The selection a panel analyses and draws: its stored request, or, when the current source lacks
 * those channels, the same fallback the clamp used to write back. The stored request is never
 * changed, so it returns with a source that has the channels.
 *
 * While the channel count is unknown the request stands: the file analysis worker snapshots the
 * request list once at start, so a guess must not replace it.
 *
 * @param {string} moduleId Workspace or Dock module id.
 * @param {any} controls The panel's stored controls.
 * @param {ChannelTopology | undefined} topology
 * @returns {{ controls: any, unavailable: boolean }} `controls` is the input itself when nothing
 *   falls back.
 */
export function resolveEffectiveChannelControls(moduleId, controls, topology) {
  const field = CHANNEL_FIELD_BY_MODULE_ID[moduleId];
  if (!field || !channelTopologyKnown(topology)) return { controls, unavailable: false };
  const normalized = normalizePanelControls(controls);
  if (field === "spectrumChannel") {
    const requested = normalized.spectrumChannel;
    const effective = clampSpectrumChannelToAvailable(
      requested,
      topology.spectrumChannelOptions ?? []
    );
    if (selectionKey(effective) === selectionKey(requested)) {
      return { controls, unavailable: false };
    }
    return { controls: { ...controls, [field]: effective }, unavailable: true };
  }
  const requested = normalized[field];
  const effective = clampVectorscopePairToAvailable(
    requested,
    Math.max(2, topology.channelCount),
    topology.peakLabelContext
  );
  if (effective.x === requested?.x && effective.y === requested?.y) {
    return { controls, unavailable: false };
  }
  return { controls: { ...controls, [field]: effective }, unavailable: true };
}

/**
 * The Workspace with every panel's channel selection resolved, for deriving what the backend
 * computes. The same object when no panel falls back.
 *
 * @param {import("../workspace/types.js").WorkspaceState} state
 * @param {ChannelTopology | undefined} topology
 */
export function effectiveWorkspaceState(state, topology) {
  if (!channelTopologyKnown(topology)) return state;
  let panelControlsById = null;
  for (const panelId of state?.panelOrder ?? []) {
    if (!state.panelsById?.[panelId]) continue;
    const stored = state.panelControlsById?.[panelId] ?? state.panelControls;
    if (!stored) continue;
    const { controls, unavailable } = resolveEffectiveChannelControls(
      resolvePanelModuleId(state, panelId),
      stored,
      topology
    );
    if (!unavailable) continue;
    panelControlsById ??= { ...state.panelControlsById };
    panelControlsById[panelId] = controls;
  }
  return panelControlsById ? { ...state, panelControlsById } : state;
}
