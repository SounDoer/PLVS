import {
  MAX_SPECTRUM_REQUESTS,
  MAX_STEREO_MAP_REQUESTS,
  MAX_VECTORSCOPE_REQUESTS,
  spectrumRequestKeyFromControls,
  stereoMapRequestKeyFromControls,
  vectorscopeRequestKeyFromControls,
} from "../analysis/analysisRequests.js";
import {
  DEFAULT_DOCK_CONTROLS_BY_MODULE_ID,
  normalizeDockModuleControls,
} from "./dockModuleControls.js";
import { dockModuleIdForPanelModuleId } from "./dockLayout.js";

function spectrumPanelControls(raw) {
  const controls = normalizeDockModuleControls("spectrum", raw);
  return {
    spectrumChannel: controls.channel,
    spectrumView: controls.view,
    spectrumSpeedPercent: controls.speedPercent,
    spectrumTiltDbPerOctave: controls.tiltDbPerOctave,
    spectrumOctaveSmoothing: controls.octaveSmoothing,
  };
}

export function dockSpectrumKey(controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum) {
  return spectrumRequestKeyFromControls(spectrumPanelControls(controls));
}

export const DOCK_SPECTRUM_KEY = dockSpectrumKey();

function vectorscopePanelControls(raw) {
  const controls = normalizeDockModuleControls("correlation", raw);
  return { vectorscopePair: controls.pair };
}

export function dockVectorscopeKey(controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.correlation) {
  return vectorscopeRequestKeyFromControls(vectorscopePanelControls(controls));
}

export const DOCK_VECTORSCOPE_KEY = dockVectorscopeKey();

function dockSpectrumRequest(raw, panelId = "dock:spectrum") {
  const controls = normalizeDockModuleControls("spectrum", raw);
  return {
    key: dockSpectrumKey(controls),
    panelIds: [panelId],
    channel: controls.channel,
    view: controls.channel?.type === "single" ? "combined" : controls.view,
    speedPercent: Math.round(controls.speedPercent),
    tiltDbPerOctave: Math.round(controls.tiltDbPerOctave * 100) / 100,
    octaveSmoothing: controls.octaveSmoothing,
  };
}

function dockVectorscopeRequest(raw, panelId = "dock:vectorscope") {
  const controls = normalizeDockModuleControls("correlation", raw);
  return {
    key: dockVectorscopeKey(controls),
    panelIds: [panelId],
    pair: controls.pair,
  };
}

export function mergeDockSpectrumRequest(derived, active, controls) {
  if (!active) return derived;
  const configured = Array.isArray(active)
    ? active
        .map((panel) => {
          const dockModuleId = dockModuleIdForPanelModuleId(panel.moduleId) ?? panel.moduleId;
          if (dockModuleId !== "spectrum" && dockModuleId !== "spectrogram") return null;
          return dockSpectrumRequest(panel.controls, `dock:${panel.panelId}`);
        })
        .filter(Boolean)
    : typeof active === "object"
      ? [
          active.spectrum ? dockSpectrumRequest(active.spectrum, "dock:spectrum") : null,
          active.spectrogram ? dockSpectrumRequest(active.spectrogram, "dock:spectrogram") : null,
        ].filter(Boolean)
      : [dockSpectrumRequest(controls)];
  const requestedByKey = new Map();
  for (const request of configured) {
    const existing = requestedByKey.get(request.key);
    requestedByKey.set(
      request.key,
      existing ? { ...existing, panelIds: [...existing.panelIds, ...request.panelIds] } : request
    );
  }
  const requests = [...requestedByKey.values()].filter(
    (request) => !derived.spectrumRequests.some((candidate) => candidate.key === request.key)
  );
  if (requests.length === 0) return derived;
  const available = Math.max(0, MAX_SPECTRUM_REQUESTS - requests.length);
  const kept =
    derived.spectrumRequests.length > available
      ? derived.spectrumRequests.slice(0, available)
      : derived.spectrumRequests;
  return {
    ...derived,
    spectrumRequests: [...kept, ...requests].slice(0, MAX_SPECTRUM_REQUESTS),
  };
}

export function mergeDockVectorscopeRequest(derived, active) {
  if (!active) return derived;
  const configured = Array.isArray(active)
    ? active
        .map((panel) => {
          const dockModuleId = dockModuleIdForPanelModuleId(panel.moduleId) ?? panel.moduleId;
          return dockModuleId === "correlation"
            ? dockVectorscopeRequest(panel.controls, `dock:${panel.panelId}`)
            : null;
        })
        .filter(Boolean)
    : [dockVectorscopeRequest()];
  const requestedByKey = new Map();
  for (const request of configured) {
    const existing = requestedByKey.get(request.key);
    requestedByKey.set(
      request.key,
      existing ? { ...existing, panelIds: [...existing.panelIds, ...request.panelIds] } : request
    );
  }
  const requests = [...requestedByKey.values()].filter(
    (request) => !derived.vectorscopeRequests.some((candidate) => candidate.key === request.key)
  );
  if (requests.length === 0) return derived;
  const available = Math.max(0, MAX_VECTORSCOPE_REQUESTS - requests.length);
  const kept =
    derived.vectorscopeRequests.length > available
      ? derived.vectorscopeRequests.slice(0, available)
      : derived.vectorscopeRequests;
  return {
    ...derived,
    vectorscopeRequests: [...kept, ...requests].slice(0, MAX_VECTORSCOPE_REQUESTS),
  };
}

function stereoMapPanelControls(raw) {
  const controls = normalizeDockModuleControls("stereoMap", raw);
  return {
    stereoMapPair: { first: controls.pair.x, second: controls.pair.y },
    stereoMapSpeedPercent: controls.speedPercent,
    stereoMapOctaveSmoothing: controls.octaveSmoothing,
  };
}

export function dockStereoMapKey(controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stereoMap) {
  return stereoMapRequestKeyFromControls(stereoMapPanelControls(controls));
}

export const DOCK_STEREO_MAP_KEY = dockStereoMapKey();

function dockStereoMapRequest(raw, panelId = "dock:stereoMap") {
  const controls = normalizeDockModuleControls("stereoMap", raw);
  return {
    key: dockStereoMapKey(controls),
    panelIds: [panelId],
    pair: { first: controls.pair.x, second: controls.pair.y },
    speedPercent: Math.round(controls.speedPercent),
    octaveSmoothing: controls.octaveSmoothing,
  };
}

export function mergeDockStereoMapRequest(derived, active) {
  if (!active) return derived;
  const configured = Array.isArray(active)
    ? active
        .map((panel) => {
          const dockModuleId = dockModuleIdForPanelModuleId(panel.moduleId) ?? panel.moduleId;
          return dockModuleId === "stereoMap"
            ? dockStereoMapRequest(panel.controls, `dock:${panel.panelId}`)
            : null;
        })
        .filter(Boolean)
    : [dockStereoMapRequest()];
  const requestedByKey = new Map();
  for (const request of configured) {
    const existing = requestedByKey.get(request.key);
    requestedByKey.set(
      request.key,
      existing ? { ...existing, panelIds: [...existing.panelIds, ...request.panelIds] } : request
    );
  }
  const requests = [...requestedByKey.values()].filter(
    (request) => !derived.stereoMapRequests.some((candidate) => candidate.key === request.key)
  );
  if (requests.length === 0) return derived;
  const available = Math.max(0, MAX_STEREO_MAP_REQUESTS - requests.length);
  const kept =
    derived.stereoMapRequests.length > available
      ? derived.stereoMapRequests.slice(0, available)
      : derived.stereoMapRequests;
  return {
    ...derived,
    stereoMapRequests: [...kept, ...requests].slice(0, MAX_STEREO_MAP_REQUESTS),
  };
}

export function mergeDockAnalysisRequests(derived, active) {
  return mergeDockVectorscopeRequest(
    mergeDockStereoMapRequest(mergeDockSpectrumRequest(derived, active), active),
    active
  );
}
