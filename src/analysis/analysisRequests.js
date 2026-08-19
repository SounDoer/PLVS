import { normalizePanelControls, SPECTRUM_OCTAVE_SMOOTHING_OPTIONS } from "../lib/panelControls.js";
import { getPanelControls } from "../workspace/panelControlInstances.js";
import { resolvePanelModuleId } from "../workspace/panelInstances.js";

export const MAX_SPECTRUM_REQUESTS = 4;
export const MAX_VECTORSCOPE_REQUESTS = 4;
export const MAX_STEREO_MAP_REQUESTS = 4;

const DEFAULT_STEREO_MAP_PAIR = { first: 0, second: 1 };
const DEFAULT_STEREO_MAP_SMOOTHING = "1/12";
const MAX_ANALYSIS_CHANNEL_INDEX = 63;

function spectrumDisplayControlsFromControls(panelControls) {
  const controls = normalizePanelControls(panelControls);
  const speedPercent = Math.round(controls.spectrumSpeedPercent);
  const tiltDbPerOctave = Math.round(controls.spectrumTiltDbPerOctave * 100) / 100;
  const tiltCentidb = Math.round(tiltDbPerOctave * 100);
  const octaveSmoothing = controls.spectrumOctaveSmoothing;
  // Looked up rather than derived from the id: ids carry a '/', which would break the
  // colon-delimited key grammar. Rust mirrors this via `OctaveSmoothing::key_token`.
  const smoothingToken =
    SPECTRUM_OCTAVE_SMOOTHING_OPTIONS.find((option) => option.id === octaveSmoothing)?.keyToken ??
    "off";
  return { speedPercent, tiltDbPerOctave, tiltCentidb, octaveSmoothing, smoothingToken };
}

function collectPanelIdsFromTree(node, panelsById, out = []) {
  if (!node) return out;
  if (node.type === "leaf") {
    for (const id of node.tabs) {
      if (panelsById?.[id]) out.push(id);
    }
    return out;
  }
  for (const child of node.children ?? []) collectPanelIdsFromTree(child, panelsById, out);
  return out;
}

export function spectrumRequestKeyFromControls(panelControls) {
  const controls = normalizePanelControls(panelControls);
  const view = controls.spectrumView ?? "combined";
  const sel = controls.spectrumChannel;
  const display = spectrumDisplayControlsFromControls(controls);
  const suffix = `sp${display.speedPercent}:tilt${display.tiltCentidb}:sm${display.smoothingToken}`;
  if (sel?.type === "single") return `spectrum:single:${sel.ch}:combined:${suffix}`;
  return `spectrum:pair:${sel?.x ?? 0}:${sel?.y ?? 1}:${view}:${suffix}`;
}

export function vectorscopeRequestKeyFromControls(panelControls) {
  const controls = normalizePanelControls(panelControls);
  const pair = controls.vectorscopePair ?? { x: 0, y: 1 };
  return `vectorscope:pair:${pair.x}:${pair.y}`;
}

function stereoMapMeasurementControlsFromControls(panelControls) {
  const rawPair = panelControls?.stereoMapPair;
  const pairIsValid =
    Number.isInteger(rawPair?.first) &&
    Number.isInteger(rawPair?.second) &&
    rawPair.first >= 0 &&
    rawPair.first <= MAX_ANALYSIS_CHANNEL_INDEX &&
    rawPair.second >= 0 &&
    rawPair.second <= MAX_ANALYSIS_CHANNEL_INDEX &&
    rawPair.first !== rawPair.second;
  const pair = pairIsValid ? rawPair : DEFAULT_STEREO_MAP_PAIR;
  const speedPercent = Math.round(
    normalizePanelControls({
      spectrumSpeedPercent: panelControls?.stereoMapSpeedPercent,
    }).spectrumSpeedPercent
  );
  const octaveSmoothing = SPECTRUM_OCTAVE_SMOOTHING_OPTIONS.some(
    (option) => option.id === panelControls?.stereoMapOctaveSmoothing
  )
    ? panelControls.stereoMapOctaveSmoothing
    : DEFAULT_STEREO_MAP_SMOOTHING;
  const smoothingToken =
    SPECTRUM_OCTAVE_SMOOTHING_OPTIONS.find((option) => option.id === octaveSmoothing)?.keyToken ??
    "12";
  return { pair, speedPercent, octaveSmoothing, smoothingToken };
}

export function stereoMapRequestKeyFromControls(panelControls) {
  const { pair, speedPercent, smoothingToken } =
    stereoMapMeasurementControlsFromControls(panelControls);
  return `stereoMap:pair:${pair.first}:${pair.second}:sp${speedPercent}:sm${smoothingToken}`;
}

function pushRequest(map, key, panelId, payload) {
  const existing = map.get(key);
  if (existing) {
    existing.panelIds.push(panelId);
    return;
  }
  map.set(key, { key, panelIds: [panelId], ...payload });
}

function capRequests(requests, max, statusByPanelId) {
  const active = requests.slice(0, max);
  const overCap = requests.slice(max);
  for (const request of overCap) {
    for (const panelId of request.panelIds) {
      statusByPanelId[panelId] = "overCap";
    }
  }
  return { active, overCap };
}

function dockPanelIdentity(panelId) {
  return `dock:${panelId}`;
}

/**
 * @typedef {object} AdditionalAnalysisPanelInstance
 * @property {string} panelId Dock-local panel id; request/status identity is namespaced as `dock:${panelId}`.
 * @property {string} moduleId Panel module id; only `"stereo-map"` contributes in this task.
 * @property {object} controls Raw module controls; read as Stereo Map controls when applicable.
 */

/**
 * @param {import("../workspace/types.js").WorkspaceState} state
 * @param {{
 *   channelCount?: number,
 *   additionalPanelInstances?: AdditionalAnalysisPanelInstance[],
 * }} [options]
 * `channelCount` is the runtime's effective channel count. Stereo Map requests are omitted unless
 * it is an integer and both selected channels are available. Additional instances are the future
 * Dock merge seam; their local panel ids are automatically namespaced and follow input order after
 * Workspace panel order.
 */
export function deriveAnalysisRequests(
  state,
  { channelCount, additionalPanelInstances = [] } = {}
) {
  const panelIdsInTree = collectPanelIdsFromTree(state.tree, state.panelsById);
  const orderedPanelIds = (state.panelOrder ?? []).filter((id) => panelIdsInTree.includes(id));
  const statusByPanelId = {};
  const spectrumByKey = new Map();
  const vectorscopeByKey = new Map();
  const stereoMapByKey = new Map();
  let spectralWaveform = false;

  const addStereoMapRequest = (panelId, controls) => {
    const measurement = stereoMapMeasurementControlsFromControls(controls);
    const pairAvailable =
      Number.isInteger(channelCount) &&
      channelCount >= 2 &&
      measurement.pair.first < channelCount &&
      measurement.pair.second < channelCount;
    if (!pairAvailable) return;
    const key = stereoMapRequestKeyFromControls(controls);
    pushRequest(stereoMapByKey, key, panelId, {
      pair: measurement.pair,
      speedPercent: measurement.speedPercent,
      octaveSmoothing: measurement.octaveSmoothing,
    });
    statusByPanelId[panelId] = "active";
  };

  for (const panelId of orderedPanelIds) {
    const moduleId = resolvePanelModuleId(state, panelId);
    const controls = getPanelControls(state, panelId);
    if (moduleId === "spectrum" || moduleId === "spectrogram") {
      const key = spectrumRequestKeyFromControls(controls);
      const display = spectrumDisplayControlsFromControls(controls);
      pushRequest(spectrumByKey, key, panelId, {
        channel: controls.spectrumChannel,
        view: controls.spectrumChannel?.type === "single" ? "combined" : controls.spectrumView,
        speedPercent: display.speedPercent,
        tiltDbPerOctave: display.tiltDbPerOctave,
        octaveSmoothing: display.octaveSmoothing,
      });
      statusByPanelId[panelId] = "active";
    } else if (moduleId === "vectorscope") {
      const key = vectorscopeRequestKeyFromControls(controls);
      pushRequest(vectorscopeByKey, key, panelId, {
        pair: controls.vectorscopePair,
      });
      statusByPanelId[panelId] = "active";
    } else if (moduleId === "stereo-map") {
      addStereoMapRequest(
        panelId,
        state.panelControlsById?.[panelId] ?? state.panelControls ?? undefined
      );
    } else if (moduleId === "waveform") {
      spectralWaveform ||= controls.waveformFrequencyColor || controls.waveformCentroid;
    }
  }

  for (const instance of additionalPanelInstances) {
    if (instance?.moduleId !== "stereo-map" || typeof instance.panelId !== "string") continue;
    addStereoMapRequest(dockPanelIdentity(instance.panelId), instance.controls);
  }

  const spectrum = capRequests([...spectrumByKey.values()], MAX_SPECTRUM_REQUESTS, statusByPanelId);
  const vectorscope = capRequests(
    [...vectorscopeByKey.values()],
    MAX_VECTORSCOPE_REQUESTS,
    statusByPanelId
  );
  const stereoMap = capRequests(
    [...stereoMapByKey.values()],
    MAX_STEREO_MAP_REQUESTS,
    statusByPanelId
  );

  return {
    spectrumRequests: spectrum.active,
    vectorscopeRequests: vectorscope.active,
    stereoMapRequests: stereoMap.active,
    overCapSpectrumRequests: spectrum.overCap,
    overCapVectorscopeRequests: vectorscope.overCap,
    overCapStereoMapRequests: stereoMap.overCap,
    spectralWaveform,
    statusByPanelId,
  };
}
