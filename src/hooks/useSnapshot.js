import { useMemo } from "react";
import { VISUAL_HIST_SAMPLE_SEC } from "./useLoudnessHistory.js";
import { buildVectorscopeSvgFromPairs } from "../math/vectorscopeMath.js";
import { buildSpectrumSvgFromBandsAndDb } from "../math/spectrumMath.js";
import { resolveSnapshot } from "../lib/snapshotResolve.js";

function freezeSnapshot(intake) {
  return {
    loudness: [...intake.getLoudnessHistory()],
    spectrumData: [...intake.getSpectrumDataSnap()],
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
  // Freeze the live rings once on entering snapshot mode; scrubbing within resolves against
  // the frozen copy so ongoing live pushes don't move the displayed point.
  const snapSource = useMemo(
    () => (isSnapshotSelected ? freezeSnapshot(intake) : null),
    [intake, isSnapshotSelected]
  );

  const histSourceList = snapSource ? snapSource.loudness : intake.getLoudnessHistory();
  const visualWaveformSnap = snapSource?.visualWaveform ?? null;

  const resolved = resolveSnapshot({
    selectedOffset,
    sampleSec,
    visualSampleSec: VISUAL_HIST_SAMPLE_SEC,
    histSourceList,
    audioList: snapSource ? snapSource.audio : intake.getAudioSnap(),
    corrList: snapSource ? snapSource.corr : intake.getCorrSnap(),
    spectrumDataList: snapSource ? snapSource.spectrumData : intake.getSpectrumDataSnap(),
    channelMetadataList: snapSource
      ? snapSource.channelMetadata
      : (intake.getChannelMetadataSnap?.() ?? []),
    visualSpectrum: snapSource?.visualSpectrum ?? [],
    visualVectorscope: snapSource?.visualVectorscope ?? [],
    liveAudio: audio,
    liveSpectrumData: intake.getSpectrumData(),
  });

  const displaySpectrumPath =
    resolved.spectrumSnapDbList != null
      ? buildSpectrumSvgFromBandsAndDb(resolved.spectrumSnapCenters, resolved.spectrumSnapDbList)
      : spectrumPath;
  const displayVectorPath =
    resolved.vectorSnapPairs != null
      ? buildVectorscopeSvgFromPairs(resolved.vectorSnapPairs)
      : vectorPath;
  const displaySpectrumPeakPath = selectedOffset >= 0 ? "" : spectrumPeakPath;

  return {
    histSourceList,
    displayAudio: resolved.displayAudio,
    displaySpectrumPath,
    displaySpectrumPeakPath,
    displaySpectrumData: resolved.displaySpectrumData,
    displayVectorPath,
    hasHistoryData: resolved.hasHistoryData,
    correlation: resolved.correlation,
    channelMetadata: resolved.channelMetadata,
    visualWaveformSnap,
    visualSnapIdx: resolved.visualSnapIdx,
    visualSpectrogramSnap: snapSource?.visualSpectrum ?? null,
  };
}
