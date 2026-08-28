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

export function dockSpectrumKey(controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum) {
  return spectrumRequestKeyFromControls(normalizeDockModuleControls("spectrum", controls));
}

export const DOCK_SPECTRUM_KEY = dockSpectrumKey();

export function dockVectorscopeKey(controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.correlation) {
  return vectorscopeRequestKeyFromControls(normalizeDockModuleControls("correlation", controls));
}

export const DOCK_VECTORSCOPE_KEY = dockVectorscopeKey();

function dockSpectrumRequest(raw, panelId = "dock:spectrum") {
  const controls = normalizeDockModuleControls("spectrum", raw);
  return {
    key: dockSpectrumKey(controls),
    panelIds: [panelId],
    channel: controls.spectrumChannel,
    view: controls.spectrumChannel?.type === "single" ? "combined" : controls.spectrumView,
    speedPercent: Math.round(controls.spectrumSpeedPercent),
    octaveSmoothing: controls.spectrumOctaveSmoothing,
  };
}

function dockVectorscopeRequest(raw, panelId = "dock:vectorscope") {
  const controls = normalizeDockModuleControls("correlation", raw);
  return {
    key: dockVectorscopeKey(controls),
    panelIds: [panelId],
    pair: controls.vectorscopePair,
  };
}

/**
 * Every request that does not reach the merged set is recorded, so the request set stops claiming
 * a panel is active while nothing computes it. Both halves matter: panel requests the dock
 * squeezed out, and dock requests the final cap could not fit.
 *
 * Returns a patch meant to be spread after `...derived`; empty when nothing was dropped. Dropped
 * dock requests get an `"overCap"` entry in `statusByPanelId`, but dock requests that fit are
 * never marked `"active"`, so the map is not a complete picture of dock ids either way.
 */
function recordDropped(derived, candidates, merged, overCapField) {
  const mergedKeys = new Set(merged.map((request) => request.key));
  const dropped = candidates.filter((request) => !mergedKeys.has(request.key));
  // No patch when nothing was dropped, so the caller keeps `derived`'s own status map by reference.
  if (dropped.length === 0) return {};
  const statusByPanelId = { ...derived.statusByPanelId };
  for (const request of dropped) {
    for (const panelId of request.panelIds) statusByPanelId[panelId] = "overCap";
  }
  return { [overCapField]: [...derived[overCapField], ...dropped], statusByPanelId };
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
  const mergedRequests = [...kept, ...requests].slice(0, MAX_SPECTRUM_REQUESTS);
  return {
    ...derived,
    spectrumRequests: mergedRequests,
    ...recordDropped(
      derived,
      [...derived.spectrumRequests, ...requests],
      mergedRequests,
      "overCapSpectrumRequests"
    ),
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
  const mergedRequests = [...kept, ...requests].slice(0, MAX_VECTORSCOPE_REQUESTS);
  return {
    ...derived,
    vectorscopeRequests: mergedRequests,
    ...recordDropped(
      derived,
      [...derived.vectorscopeRequests, ...requests],
      mergedRequests,
      "overCapVectorscopeRequests"
    ),
  };
}

export function dockStereoMapKey(controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.stereoMap) {
  return stereoMapRequestKeyFromControls(normalizeDockModuleControls("stereoMap", controls));
}

export const DOCK_STEREO_MAP_KEY = dockStereoMapKey();

function dockStereoMapRequest(raw, panelId = "dock:stereoMap") {
  const controls = normalizeDockModuleControls("stereoMap", raw);
  return {
    key: dockStereoMapKey(controls),
    panelIds: [panelId],
    // The request payload keeps the Rust type's { first, second } pair; the stored control is
    // { x, y } like every other channel pair.
    pair: { first: controls.stereoMapPair.x, second: controls.stereoMapPair.y },
    speedPercent: Math.round(controls.stereoMapSpeedPercent),
    octaveSmoothing: controls.stereoMapOctaveSmoothing,
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
  const mergedRequests = [...kept, ...requests].slice(0, MAX_STEREO_MAP_REQUESTS);
  return {
    ...derived,
    stereoMapRequests: mergedRequests,
    ...recordDropped(
      derived,
      [...derived.stereoMapRequests, ...requests],
      mergedRequests,
      "overCapStereoMapRequests"
    ),
  };
}

/**
 * Adds the dock modules' keys to the retained set. Layered on top of the analysis half the same
 * way `mergeDockAnalysisRequests` is, so the dock keeps depending on analysis and not the reverse.
 *
 * Dock keys are retained whether or not the dock is currently showing: `AppShell` renders the
 * strip or the panels, never both, so whichever is hidden comes back intact.
 */
export function mergeDockRetainedKeys(retained, dockPanels) {
  if (!Array.isArray(dockPanels) || dockPanels.length === 0) return retained;
  const spectrum = new Set(retained.spectrum);
  const vectorscope = new Set(retained.vectorscope);
  const stereoMap = new Set(retained.stereoMap);
  const stereoMapModesByKey = new Map(
    [...(retained.stereoMapModesByKey ?? [])].map(([key, modes]) => [key, new Set(modes)])
  );

  for (const panel of dockPanels) {
    const dockModuleId = dockModuleIdForPanelModuleId(panel.moduleId) ?? panel.moduleId;
    if (dockModuleId === "spectrum" || dockModuleId === "spectrogram") {
      spectrum.add(dockSpectrumKey(panel.controls));
    } else if (dockModuleId === "correlation") {
      vectorscope.add(dockVectorscopeKey(panel.controls));
    } else if (dockModuleId === "stereoMap") {
      const controls = normalizeDockModuleControls("stereoMap", panel.controls);
      const key = dockStereoMapKey(controls);
      stereoMap.add(key);
      const modes = stereoMapModesByKey.get(key) ?? new Set();
      modes.add(controls.stereoMapMode);
      stereoMapModesByKey.set(key, modes);
    }
  }

  return { spectrum, vectorscope, stereoMap, stereoMapModesByKey };
}

export function mergeDockAnalysisRequests(derived, active) {
  const merged = mergeDockVectorscopeRequest(
    mergeDockStereoMapRequest(mergeDockSpectrumRequest(derived, active), active),
    active
  );
  if (!Array.isArray(active)) return merged;
  const dockNeedsSpectralWaveform = active.some((panel) => {
    const dockModuleId = dockModuleIdForPanelModuleId(panel.moduleId) ?? panel.moduleId;
    if (dockModuleId !== "waveform") return false;
    const controls = normalizeDockModuleControls("waveform", panel.controls);
    return controls.waveformFrequencyColor || controls.waveformCentroid;
  });
  return dockNeedsSpectralWaveform && !merged.spectralWaveform
    ? { ...merged, spectralWaveform: true }
    : merged;
}
