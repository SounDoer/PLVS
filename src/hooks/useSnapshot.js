import { useMemo } from "react";

function freezeSnapshot(intake) {
  return {
    loudness: [...intake.getLoudnessHistory()],
    spectrum: [...intake.getSpectrumSnap()],
    spectrumData: [...intake.getSpectrumDataSnap()],
    vector: [...intake.getVectorSnap()],
    corr: [...intake.getCorrSnap()],
    audio: [...intake.getAudioSnap()],
    channelMetadata: [...(intake.getChannelMetadataSnap?.() ?? [])],
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
  const snapChannelMetadataList = snapSource
    ? snapSource.channelMetadata
    : (intake.getChannelMetadataSnap?.() ?? []);

  const selectedHistSteps =
    selectedOffset >= 0 ? Math.max(0, Math.round(selectedOffset / sampleSec)) : -1;
  const snapIdx =
    selectedHistSteps >= 0 ? Math.max(0, snapSpecList.length - 1 - selectedHistSteps) : -1;
  const audioSnapIdx =
    selectedHistSteps >= 0 ? Math.max(0, snapAudioList.length - 1 - selectedHistSteps) : -1;

  const displayAudio =
    audioSnapIdx >= 0 && snapAudioList[audioSnapIdx] ? snapAudioList[audioSnapIdx] : audio;
  const displaySpectrumPath =
    snapIdx >= 0 && snapSpecList[snapIdx] ? snapSpecList[snapIdx] : spectrumPath;
  const displaySpectrumPeakPath = selectedOffset >= 0 ? "" : spectrumPeakPath;
  const displaySpectrumData =
    snapIdx >= 0 && snapSpecDataList[snapIdx]
      ? snapSpecDataList[snapIdx]
      : intake.getSpectrumData();
  const displayVectorPath =
    snapIdx >= 0 && snapVecList[snapIdx] ? snapVecList[snapIdx] : vectorPath;
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
  };
}
