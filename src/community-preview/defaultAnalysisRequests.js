import { deriveAnalysisRequests } from "../analysis/analysisRequests.js";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";

export function buildDefaultCommunityPreviewAnalysisRequests() {
  const derived = deriveAnalysisRequests(DEFAULT_WORKSPACE_STATE, { channelCount: 2 });
  return {
    spectrum: derived.spectrumRequests.map(({ panelIds: _panelIds, ...request }) => request),
    vectorscope: derived.vectorscopeRequests.map(({ key, pair }) => ({
      key,
      x: pair.x,
      y: pair.y,
    })),
    stereoMap: derived.stereoMapRequests.map(({ panelIds: _panelIds, ...request }) => request),
    spectralWaveform: derived.spectralWaveform,
  };
}
