/**
 * @typedef {{ type: "pair"; x: number; y: number } | { type: "single"; ch: number }} SpectrumChannelSel
 */

export const SPECTRUM_VIEW_OPTIONS = [
  { key: "combined", label: "Combined" },
  { key: "lr", label: "L / R" },
  { key: "ms", label: "M / S" },
];

/** View modes only apply to pair selections (singles are always one curve). */
export function spectrumViewApplies(sel) {
  return sel?.type === "pair";
}

/**
 * Legend entries for the overlaid curves, or null when there is only one curve.
 * @param {"combined"|"lr"|"ms"} view
 * @param {SpectrumChannelSel} sel
 * @param {string[]} labels per-channel labels (index by channel)
 * @returns {{ token: "primary"|"secondary"; label: string }[] | null}
 */
export function spectrumViewLegend(view, sel, labels) {
  if (!spectrumViewApplies(sel)) return null;
  if (view === "ms") {
    return [
      { token: "primary", label: "Mid" },
      { token: "secondary", label: "Side" },
    ];
  }
  if (view === "lr") {
    const lx = labels[sel.x] ?? `Ch ${sel.x + 1}`;
    const ly = labels[sel.y] ?? `Ch ${sel.y + 1}`;
    return [
      { token: "primary", label: lx },
      { token: "secondary", label: ly },
    ];
  }
  return null;
}
