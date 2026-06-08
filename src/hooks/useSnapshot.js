import { useMemo } from "react";
import { VISUAL_HIST_SAMPLE_SEC } from "./useLoudnessHistory.js";
import { buildVectorscopeSvgFromPairs } from "../math/vectorscopeMath.js";
import { buildSpectrumSvgFromBandsAndDb } from "../math/spectrumMath.js";

function freezeSnapshot(intake) {
  return {
    loudness: [...intake.getLoudnessHistory()],
    spectrum: [...intake.getSpectrumSnap()],
    spectrumData: [...intake.getSpectrumDataSnap()],
    vector: [...intake.getVectorSnap()],
    corr: [...intake.getCorrSnap()],
    audio: [...intake.getAudioSnap()],
    channelMetadata: [...(intake.getChannelMetadataSnap?.() ?? [])],
    visualWaveform: intake.getVisualWaveformHist().toArray(),
    visualSpectrum: intake.getVisualSpectrumHist().toArray(),
    visualVectorscope: intake.getVisualVectorscopeHist().toArray(),
    visualCorr: intake.getVisualCorrHist().toArray(),
  };
}

export function useSnapshot({
  selectedOffset,
  sampleSec,
  intake,
  audio,
  spectrumPath,
  spectrumPeakPath,
  vectorPath,
}) {
  const isSnapshotSelected = selectedOffset >= 0;
  const snapSource = useMemo(
    () => (isSnapshotSelected ? freezeSnapshot(intake) : null),
    [intake, isSnapshotSelected]
  );
  const histSourceList = snapSource ? snapSource.loudness : intake.getLoudnessHistory();
  const snapCorrList = snapSource ? snapSource.corr : intake.getCorrSnap();
  const snapSpecList = snapSource ? snapSource.spectrum : intake.getSpectrumSnap();
  const snapSpecDataList = snapSource ? snapSource.spectrumData : intake.getSpectrumDataSnap();
  const snapVecList = snapSource ? snapSource.vector : intake.getVectorSnap();
  const snapAudioList = snapSource ? snapSource.audio : intake.getAudioSnap();
  const visualSpecSnap = snapSource?.visualSpectrum ?? [];
  const visualVsSnap = snapSource?.visualVectorscope ?? [];
  const visualWaveformSnap = snapSource?.visualWaveform ?? null;
  const snapChannelMetadataList = snapSource
    ? snapSource.channelMetadata
    : (intake.getChannelMetadataSnap?.() ?? []);

  const selectedHistSteps =
    selectedOffset >= 0 ? Math.max(0, Math.round(selectedOffset / sampleSec)) : -1;
  const snapIdx =
    selectedHistSteps >= 0 ? Math.max(0, snapSpecList.length - 1 - selectedHistSteps) : -1;
  const audioSnapIdx =
    selectedHistSteps >= 0 ? Math.max(0, snapAudioList.length - 1 - selectedHistSteps) : -1;
  const visualSnapIdx =
    selectedOffset >= 0
      ? Math.max(0, visualSpecSnap.length - 1 - Math.round(selectedOffset / VISUAL_HIST_SAMPLE_SEC))
      : -1;

  const displayAudio =
    audioSnapIdx >= 0 && snapAudioList[audioSnapIdx] ? snapAudioList[audioSnapIdx] : audio;
  const displaySpectrumPath = (() => {
    if (visualSnapIdx >= 0 && visualSpecSnap[visualSnapIdx]) {
      const snap = visualSpecSnap[visualSnapIdx];
      // Band centers come from the current spectrum data (fixed per session).
      const snapData =
        snapIdx >= 0 && snapSpecDataList[snapIdx]
          ? snapSpecDataList[snapIdx]
          : intake.getSpectrumData();
      const centers = (snapData?.bands ?? []).map((b) => b.fCenter);
      return buildSpectrumSvgFromBandsAndDb(centers, snap.dbList ?? []);
    }
    return snapIdx >= 0 && snapSpecList[snapIdx] ? snapSpecList[snapIdx] : spectrumPath;
  })();
  const displaySpectrumPeakPath = selectedOffset >= 0 ? "" : spectrumPeakPath;
  const displaySpectrumData =
    snapIdx >= 0 && snapSpecDataList[snapIdx]
      ? snapSpecDataList[snapIdx]
      : intake.getSpectrumData();
  const displayVectorPath = (() => {
    if (visualSnapIdx >= 0 && visualVsSnap[visualSnapIdx]) {
      return buildVectorscopeSvgFromPairs(visualVsSnap[visualSnapIdx]);
    }
    return snapIdx >= 0 && snapVecList[snapIdx] ? snapVecList[snapIdx] : vectorPath;
  })();
  const hasHistoryData = histSourceList.length > 0;
  const correlation =
    snapIdx >= 0 && Number.isFinite(snapCorrList[snapIdx])
      ? snapCorrList[snapIdx]
      : displayAudio.correlation;
  const channelMetadata =
    snapIdx >= 0 && snapChannelMetadataList[snapIdx] ? snapChannelMetadataList[snapIdx] : null;

  return {
    histSourceList,
    displayAudio,
    displaySpectrumPath,
    displaySpectrumPeakPath,
    displaySpectrumData,
    displayVectorPath,
    hasHistoryData,
    correlation,
    channelMetadata,
    visualWaveformSnap,
    visualSnapIdx,
  };
}
