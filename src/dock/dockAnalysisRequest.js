import { normalizePanelControls } from "../lib/panelControls.js";
import {
  MAX_SPECTRUM_REQUESTS,
  spectrumRequestKeyFromControls,
} from "../analysis/analysisRequests.js";

const DEFAULT_CONTROLS = normalizePanelControls(undefined);

/** Dock uses the default (reference-view) spectrum request. */
export const DOCK_SPECTRUM_KEY = spectrumRequestKeyFromControls(DEFAULT_CONTROLS);

function dockSpectrumRequest() {
  return {
    key: DOCK_SPECTRUM_KEY,
    panelIds: ["dock:spectrum"],
    channel: DEFAULT_CONTROLS.spectrumChannel,
    view:
      DEFAULT_CONTROLS.spectrumChannel?.type === "single"
        ? "combined"
        : DEFAULT_CONTROLS.spectrumView,
    smoothingPercent: Math.round(DEFAULT_CONTROLS.spectrumSmoothingPercent),
    tiltDbPerOctave: Math.round(DEFAULT_CONTROLS.spectrumTiltDbPerOctave * 100) / 100,
  };
}

/**
 * Ensure the dock's spectrum request is present while dock mode shows the
 * spectrum module. Requests derive from the workspace tree, which is not
 * rendered while docked — without this merge, a workspace with no Spectrum
 * panel would leave DockSpectrum with no data.
 */
export function mergeDockSpectrumRequest(derived, active) {
  if (!active) return derived;
  if (derived.spectrumRequests.some((r) => r.key === DOCK_SPECTRUM_KEY)) return derived;
  // deriveAnalysisRequests already caps spectrumRequests at MAX_SPECTRUM_REQUESTS.
  // Appending unconditionally could push the set to MAX+1, which Rust rejects
  // wholesale (set_analysis_requests fails) and silently starves dock spectrum.
  // While docked the workspace panels are invisible, so evict from the tail to
  // make room. This self-heals on exit: the merge is inactive then, restoring
  // the workspace's own requests.
  const kept =
    derived.spectrumRequests.length >= MAX_SPECTRUM_REQUESTS
      ? derived.spectrumRequests.slice(0, MAX_SPECTRUM_REQUESTS - 1)
      : derived.spectrumRequests;
  return {
    ...derived,
    spectrumRequests: [...kept, dockSpectrumRequest()],
  };
}
