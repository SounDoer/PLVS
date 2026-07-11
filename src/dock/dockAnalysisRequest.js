import { normalizePanelControls } from "../lib/panelControls.js";
import { spectrumRequestKeyFromControls } from "../analysis/analysisRequests.js";

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
  return {
    ...derived,
    spectrumRequests: [...derived.spectrumRequests, dockSpectrumRequest()],
  };
}
