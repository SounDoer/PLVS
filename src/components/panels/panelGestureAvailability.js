import { normalizePanelControls } from "../../lib/panelControls.js";

// Readiness is deliberately separate: silence or empty history must not hide the reference.
// Both the help resolver and conditional chart handlers use these predicates.
export function spectrumGestureAvailability(controls, isSnapshot) {
  const normalized = normalizePanelControls(controls);
  return {
    holdSlow: !isSnapshot,
    clearMaxHold: !isSnapshot && normalized.spectrumMaxMode === "hold",
  };
}

export function vectorscopeGestureAvailability(controls, isSnapshot) {
  const normalized = normalizePanelControls(controls);
  return {
    holdSlow: !isSnapshot && normalized.vectorscopeMode === "lissajous",
    resetMaxHold:
      !isSnapshot &&
      normalized.vectorscopeMode === "polarLevel" &&
      normalized.vectorscopePolarLevelMaxHold,
  };
}
