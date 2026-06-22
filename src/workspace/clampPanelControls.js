import { getPanelControls } from "./panelControlInstances.js";
import { resolvePanelModuleId } from "./panelInstances.js";
import { clampSpectrumChannelToAvailable } from "../math/spectrumChannelOptions.js";
import { clampVectorscopePairToAvailable } from "../math/vectorscopePairMath.js";

function spectrumChannelKey(sel) {
  return sel.type === "pair" ? `p-${sel.x}-${sel.y}` : `s-${sel.ch}`;
}

/**
 * Clamp every panel instance's channel selection to the currently available channels.
 *
 * Pure: returns the list of panels whose stored selection is out of range for the
 * current channel layout, paired with the corrected controls. Spectrum/Spectrogram
 * panels clamp `spectrumChannel`; Vectorscope panels clamp `vectorscopePair`. This
 * runs across all panel instances (not just the first) so that lowering the device
 * channel count repairs every panel's out-of-range selection, keeping each panel's
 * derived analysis request key valid.
 *
 * @param {import("./types.js").WorkspaceState} state
 * @param {{
 *   spectrumChannelOptions: import("../math/spectrumChannelOptions.js").SpectrumChannelOption[],
 *   channelCount: number,
 *   peakLabelContext: import("../math/peakMeterChannelLabels.js").PeakMeterChannelLabelsContext,
 * }} ctx
 * @returns {{ panelId: string, panelControls: object }[]}
 */
export function deriveClampedPanelControls(
  state,
  { spectrumChannelOptions, channelCount, peakLabelContext }
) {
  const updates = [];
  for (const panelId of state?.panelOrder ?? []) {
    if (!state.panelsById?.[panelId]) continue;
    const moduleId = resolvePanelModuleId(state, panelId);
    const controls = getPanelControls(state, panelId);
    if (moduleId === "spectrum" || moduleId === "spectrogram") {
      const next = clampSpectrumChannelToAvailable(
        controls.spectrumChannel,
        spectrumChannelOptions
      );
      if (spectrumChannelKey(next) !== spectrumChannelKey(controls.spectrumChannel)) {
        updates.push({ panelId, panelControls: { ...controls, spectrumChannel: next } });
      }
    } else if (moduleId === "vectorscope") {
      const next = clampVectorscopePairToAvailable(
        controls.vectorscopePair,
        channelCount,
        peakLabelContext
      );
      if (next.x !== controls.vectorscopePair.x || next.y !== controls.vectorscopePair.y) {
        updates.push({ panelId, panelControls: { ...controls, vectorscopePair: next } });
      }
    }
  }
  return updates;
}
