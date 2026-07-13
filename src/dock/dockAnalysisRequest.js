import {
  MAX_SPECTRUM_REQUESTS,
  spectrumRequestKeyFromControls,
} from "../analysis/analysisRequests.js";
import {
  DEFAULT_DOCK_CONTROLS_BY_MODULE_ID,
  normalizeDockModuleControls,
} from "./dockModuleControls.js";

function spectrumPanelControls(raw) {
  const controls = normalizeDockModuleControls("spectrum", raw);
  return {
    spectrumChannel: controls.channel,
    spectrumView: controls.view,
    spectrumSmoothingPercent: controls.smoothingPercent,
    spectrumTiltDbPerOctave: controls.tiltDbPerOctave,
  };
}

export function dockSpectrumKey(controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum) {
  return spectrumRequestKeyFromControls(spectrumPanelControls(controls));
}

export const DOCK_SPECTRUM_KEY = dockSpectrumKey();

function dockSpectrumRequest(raw, panelId = "dock:spectrum") {
  const controls = normalizeDockModuleControls("spectrum", raw);
  return {
    key: dockSpectrumKey(controls),
    panelIds: [panelId],
    channel: controls.channel,
    view: controls.channel?.type === "single" ? "combined" : controls.view,
    smoothingPercent: Math.round(controls.smoothingPercent),
    tiltDbPerOctave: Math.round(controls.tiltDbPerOctave * 100) / 100,
  };
}

export function mergeDockSpectrumRequest(derived, active, controls) {
  if (!active) return derived;
  const configured =
    typeof active === "object"
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
