import {
  MAX_SPECTRUM_REQUESTS,
  MAX_VECTORSCOPE_REQUESTS,
  spectrumRequestKeyFromControls,
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

export function mergeDockAnalysisRequests(derived, active) {
  return mergeDockVectorscopeRequest(mergeDockSpectrumRequest(derived, active), active);
}
