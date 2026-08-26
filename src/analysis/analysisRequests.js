import {
  normalizePanelControlValue,
  normalizePanelControls,
  SPECTRUM_OCTAVE_SMOOTHING_OPTIONS,
} from "../lib/panelControls.js";
import { getPanelControls } from "../workspace/panelControlInstances.js";
import { resolvePanelModuleId } from "../workspace/panelInstances.js";

export const MAX_SPECTRUM_REQUESTS = 4;
export const MAX_VECTORSCOPE_REQUESTS = 4;
export const MAX_STEREO_MAP_REQUESTS = 4;

const DEFAULT_STEREO_MAP_PAIR = { x: 0, y: 1 };
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
  // Through the row, so a pair stored in the older { first, second } shape is read the same way
  // a stored panel record would read it.
  const rawPair = normalizePanelControlValue("stereoMapPair", panelControls?.stereoMapPair);
  const pairIsValid =
    Number.isInteger(rawPair?.x) &&
    Number.isInteger(rawPair?.y) &&
    rawPair.x >= 0 &&
    rawPair.x <= MAX_ANALYSIS_CHANNEL_INDEX &&
    rawPair.y >= 0 &&
    rawPair.y <= MAX_ANALYSIS_CHANNEL_INDEX &&
    rawPair.x !== rawPair.y;
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
  return `stereoMap:pair:${pair.x}:${pair.y}:sp${speedPercent}:sm${smoothingToken}`;
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
      measurement.pair.x < channelCount &&
      measurement.pair.y < channelCount;
    if (!pairAvailable) return;
    const key = stereoMapRequestKeyFromControls(controls);
    pushRequest(stereoMapByKey, key, panelId, {
      // The Rust request type names the pair { first, second }; the stored control is { x, y }.
      pair: { first: measurement.pair.x, second: measurement.pair.y },
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

/**
 * The analysis keys whose history is worth keeping: one per open panel, with no request cap, no
 * dock merge and no availability gate.
 *
 * This deliberately does not reuse `deriveAnalysisRequests`. That answers "what should Rust
 * compute right now", which is a different question -- a panel that lost the cap, or whose slot
 * the dock took, or whose channel pair is momentarily unavailable, is still open and still wants
 * its history. Deriving retention from the request list would delete it.
 */
export function deriveRetainedAnalysisKeys(state) {
  const panelIdsInTree = collectPanelIdsFromTree(state?.tree, state?.panelsById);
  const orderedPanelIds = (state?.panelOrder ?? []).filter((id) => panelIdsInTree.includes(id));
  const spectrum = new Set();
  const vectorscope = new Set();
  const stereoMap = new Set();

  for (const panelId of orderedPanelIds) {
    const moduleId = resolvePanelModuleId(state, panelId);
    if (moduleId === "spectrum" || moduleId === "spectrogram") {
      spectrum.add(spectrumRequestKeyFromControls(getPanelControls(state, panelId)));
    } else if (moduleId === "vectorscope") {
      vectorscope.add(vectorscopeRequestKeyFromControls(getPanelControls(state, panelId)));
    } else if (moduleId === "stereo-map") {
      stereoMap.add(
        stereoMapRequestKeyFromControls(
          state.panelControlsById?.[panelId] ?? state.panelControls ?? undefined
        )
      );
    }
  }

  return { spectrum, vectorscope, stereoMap };
}
