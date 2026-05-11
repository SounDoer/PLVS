import { useRef } from "react";

export function useSnapshot({
  selectedOffset,
  sampleSec,
  loudnessHistRef,
  spectrumSnapRef,
  spectrumDataRef,
  spectrumDataSnapRef,
  vectorSnapRef,
  corrSnapRef,
  audioSnapRef,
  audio,
  spectrumPath,
  spectrumPeakPath,
  vectorPath,
}) {
  const frozenSnapRef = useRef(null);

  if (selectedOffset < 0) {
    frozenSnapRef.current = null;
  } else if (!frozenSnapRef.current) {
    frozenSnapRef.current = {
      loudness: [...loudnessHistRef.current],
      spectrum: [...spectrumSnapRef.current],
      spectrumData: [...spectrumDataSnapRef.current],
      vector: [...vectorSnapRef.current],
      corr: [...corrSnapRef.current],
      audio: [...audioSnapRef.current],
    };
  }

  const snapSource = selectedOffset >= 0 && frozenSnapRef.current ? frozenSnapRef.current : null;
  const histSourceList = snapSource ? snapSource.loudness : loudnessHistRef.current;
  const snapCorrList = snapSource ? snapSource.corr : corrSnapRef.current;
  const snapSpecList = snapSource ? snapSource.spectrum : spectrumSnapRef.current;
  const snapSpecDataList = snapSource ? snapSource.spectrumData : spectrumDataSnapRef.current;
  const snapVecList = snapSource ? snapSource.vector : vectorSnapRef.current;
  const snapAudioList = snapSource ? snapSource.audio : audioSnapRef.current;

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
    snapIdx >= 0 && snapSpecDataList[snapIdx] ? snapSpecDataList[snapIdx] : spectrumDataRef.current;
  const displayVectorPath =
    snapIdx >= 0 && snapVecList[snapIdx] ? snapVecList[snapIdx] : vectorPath;
  const hasHistoryData = histSourceList.length > 0;
  const correlation =
    snapIdx >= 0 && Number.isFinite(snapCorrList[snapIdx])
      ? snapCorrList[snapIdx]
      : displayAudio.correlation;

  return {
    histSourceList,
    displayAudio,
    displaySpectrumPath,
    displaySpectrumPeakPath,
    displaySpectrumData,
    displayVectorPath,
    hasHistoryData,
    correlation,
  };
}
