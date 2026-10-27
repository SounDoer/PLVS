import { useMemo } from "react";
import { resolveEffectiveChannelControls } from "../../analysis/effectiveChannels.js";
import { useFrameData } from "../../workspace/AudioDataContext.jsx";

/**
 * The panel's controls with the channel selection it actually analyses: its request, or the
 * fallback while the source lacks those channels. For deriving the request key and naming what is
 * drawn only -- anything that writes controls back must keep using the stored ones, or a fallback
 * would be saved as the request.
 *
 * @param {string} moduleId
 * @param {any} panelControls The panel's stored controls.
 */
export function useEffectiveChannelControls(moduleId, panelControls) {
  const { channelCount, spectrumChannelOptions, peakLabelContext } = useFrameData();
  return useMemo(
    () =>
      resolveEffectiveChannelControls(moduleId, panelControls, {
        channelCount,
        spectrumChannelOptions,
        peakLabelContext,
      }).controls,
    [moduleId, panelControls, channelCount, spectrumChannelOptions, peakLabelContext]
  );
}
