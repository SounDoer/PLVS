import { useMemo } from "react";
import { VISUAL_HIST_SAMPLE_SEC } from "./useLoudnessHistory.js";
import { buildVectorscopeSvgFromPairs } from "../math/vectorscopeMath.js";
import { buildSpectrumSvgFromBandsAndDb } from "../math/spectrumMath.js";
import { resolveSnapshot, resolveKeyedVisualIndex } from "../lib/snapshotResolve.js";

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
    spectrumByKey: intake.snapshotVisualSpectrumByKey?.() ?? {},
    vectorscopeByKey: intake.snapshotVisualVectorscopeByKey?.() ?? {},
  };
}

export function useSnapshot({
  selectedOffset,
  sampleSec,
  intake,
  audio,
  spectrumPath,
  spectrumPeakPath,
  spectrumPathB,
  spectrumPeakPathB,
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
  const displaySpectrumPathB =
    resolved.spectrumSnapDbListB != null && resolved.spectrumSnapDbListB.length > 0
      ? buildSpectrumSvgFromBandsAndDb(resolved.spectrumSnapCenters, resolved.spectrumSnapDbListB)
      : selectedOffset >= 0
        ? ""
        : spectrumPathB;
  const displayVectorPath =
    resolved.vectorSnapPairs != null
      ? buildVectorscopeSvgFromPairs(resolved.vectorSnapPairs)
      : vectorPath;
  const displaySpectrumPeakPath = selectedOffset >= 0 ? "" : spectrumPeakPath;
  const displaySpectrumPeakPathB = selectedOffset >= 0 ? "" : spectrumPeakPathB;

  // Per-request-key snapshot resolution: each Spectrum/Spectrogram/Vectorscope panel derives its
  // own request key and looks up history for that key at the selected timestamp. A request that did
  // not exist at the selected time resolves to { missing: true } so the panel can show an empty
  // state instead of another request's data.
  const keyToleranceMs = VISUAL_HIST_SAMPLE_SEC * 1000;
  const snapshotSpectrumByKey = snapSource?.spectrumByKey ?? null;
  const resolveSpectrumSnapshotForKey = (key) => {
    const entries = snapSource?.spectrumByKey?.[key];
    const { index, missing } = resolveKeyedVisualIndex(
      entries,
      resolved.targetTimestampMs,
      keyToleranceMs
    );
    if (missing) return { missing: true, path: "", pathB: "", data: null };
    const snap = entries[index];
    const centers = (snap.bands ?? []).map((b) => b.fCenter);
    const dbList = snap.dbList ?? [];
    const dbListB = snap.dbListB ?? [];
    return {
      missing: false,
      path: dbList.length ? buildSpectrumSvgFromBandsAndDb(centers, dbList) : "",
      pathB: dbListB.length ? buildSpectrumSvgFromBandsAndDb(centers, dbListB) : "",
      data: { bands: snap.bands ?? [], dbList, dbListB },
    };
  };
  const resolveVectorscopeSnapshotForKey = (key) => {
    const entries = snapSource?.vectorscopeByKey?.[key];
    const { index, missing } = resolveKeyedVisualIndex(
      entries,
      resolved.targetTimestampMs,
      keyToleranceMs
    );
    if (missing) return { missing: true, path: "", correlation: -Infinity };
    const snap = entries[index];
    return {
      missing: false,
      path: buildVectorscopeSvgFromPairs(snap?.pairs ?? []),
      correlation: Number.isFinite(snap?.correlation) ? snap.correlation : -Infinity,
    };
  };

  return {
    histSourceList,
    displayAudio: resolved.displayAudio,
    displaySpectrumPath,
    displaySpectrumPathB,
    displaySpectrumPeakPath,
    displaySpectrumPeakPathB,
    displaySpectrumData: resolved.displaySpectrumData,
    displayVectorPath,
    hasHistoryData: resolved.hasHistoryData,
    correlation: resolved.correlation,
    channelMetadata: resolved.channelMetadata,
    visualWaveformSnap,
    visualSnapIdx: resolved.visualSnapIdx,
    targetTimestampMs: resolved.targetTimestampMs,
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
  };
}
