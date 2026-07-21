import { useMemo, useRef } from "react";
import { VISUAL_HIST_SAMPLE_SEC } from "./useLoudnessHistory.js";
import { buildVectorscopeSvgFromPairs } from "../math/vectorscopeMath.js";
import {
  buildPolarLevelPeakHoldTable,
  polarLevelPeakHoldAt,
} from "../math/vectorscopePolarMath.js";
import { buildSpectrumSvgFromBandsAndDb } from "../math/spectrumMath.js";
import { resolveSnapshot, resolveKeyedVisualIndex } from "../lib/snapshotResolve.js";

const VECTORSCOPE_SIGNAL_FLOOR = 10 ** (-90 / 20);

function vectorscopePairsHaveSignal(pairs) {
  if (!pairs?.length) return false;
  for (const sample of pairs) {
    if (Number.isFinite(sample) && Math.abs(sample) > VECTORSCOPE_SIGNAL_FLOOR) return true;
  }
  return false;
}

function freezeSnapshot(intake) {
  return {
    loudness: [...intake.getLoudnessHistory()],
    corr: [...intake.getCorrSnap()],
    audio: [...intake.getAudioSnap()],
    channelMetadata: [...(intake.getChannelMetadataSnap?.() ?? [])],
    spectrumByKey: intake.snapshotVisualSpectrumByKey?.() ?? {},
    vectorscopeByKey: intake.snapshotVisualVectorscopeByKey?.() ?? {},
  };
}

export function useSnapshot({ selectedOffset, sampleSec, intake, audio }) {
  const isSnapshotSelected = selectedOffset >= 0;
  // Freeze the live rings once on entering snapshot mode; scrubbing within resolves against
  // the frozen copy so ongoing live pushes don't move the displayed point.
  const snapSource = useMemo(
    () => (isSnapshotSelected ? freezeSnapshot(intake) : null),
    [intake, isSnapshotSelected]
  );

  const histSourceList = snapSource ? snapSource.loudness : intake.getLoudnessHistory();

  const resolved = resolveSnapshot({
    selectedOffset,
    sampleSec,
    histSourceList,
    audioList: snapSource ? snapSource.audio : intake.getAudioSnap(),
    corrList: snapSource ? snapSource.corr : intake.getCorrSnap(),
    channelMetadataList: snapSource
      ? snapSource.channelMetadata
      : (intake.getChannelMetadataSnap?.() ?? []),
    liveAudio: audio,
  });

  // Per-request-key snapshot resolution: each Spectrum/Spectrogram/Vectorscope panel derives its
  // own request key and looks up history for that key at the selected timestamp. A request that did
  // not exist at the selected time resolves to { missing: true } so the panel can show an empty
  // state instead of another request's data.
  const keyToleranceMs = VISUAL_HIST_SAMPLE_SEC * 1000;
  const snapshotSpectrumByKey = snapSource?.spectrumByKey ?? null;
  // Cache the Peak hold prefix table per frozen vectorscope view. The frozen view is stable for the
  // whole snapshot session, so the O(samples) table build runs once per key; scrubbing then costs a
  // single lookup. Keyed by the view object so a new snapshot session drops the old table via GC.
  const peakHoldTableCacheRef = useRef(new WeakMap());
  const resolveSpectrumSnapshotForKey = (key) => {
    const entries = snapSource?.spectrumByKey?.[key];
    const { index, missing } = resolveKeyedVisualIndex(
      entries,
      resolved.targetTimestampMs,
      keyToleranceMs
    );
    if (missing) return { missing: true, path: "", pathB: "", data: null };
    const snap = entries.rowAt(index);
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
  // Polar Level Peak hold in snapshot mode is reconstructed from the frozen history up to the
  // selected row (see vectorscopePolarMath). Only built when a Polar Level panel with Peak hold on
  // asks for it (withPeakHold), so Lissajous/Sample scrubbing never pays for it.
  const peakHoldEnvelopeFor = (entries, index) => {
    if (!entries || index < 0) return null;
    const cache = peakHoldTableCacheRef.current;
    let table = cache.get(entries);
    if (!table) {
      table = buildPolarLevelPeakHoldTable(entries);
      cache.set(entries, table);
    }
    return polarLevelPeakHoldAt(table, index);
  };
  const resolveVectorscopeSnapshotForKey = (key, { withPeakHold = false } = {}) => {
    const entries = snapSource?.vectorscopeByKey?.[key];
    const { index, missing } = resolveKeyedVisualIndex(
      entries,
      resolved.targetTimestampMs,
      keyToleranceMs
    );
    if (missing) {
      return { missing: true, path: "", pairs: null, correlation: -Infinity, peakHold: null };
    }
    const snap = typeof entries?.rowAt === "function" ? entries.rowAt(index) : entries[index];
    const pairs = snap?.pairs ?? [];
    return {
      missing: false,
      path: buildVectorscopeSvgFromPairs(pairs),
      pairs,
      peakHold: withPeakHold ? peakHoldEnvelopeFor(entries, index) : null,
      correlation: Number.isFinite(snap?.correlation) ? snap.correlation : -Infinity,
      sideToMidDb: Number.isFinite(snap?.sideToMidDb) ? snap.sideToMidDb : -Infinity,
      midEnergy: Number.isFinite(snap?.midEnergy) ? snap.midEnergy : 0,
      sideEnergy: Number.isFinite(snap?.sideEnergy) ? snap.sideEnergy : 0,
      hasSignal: vectorscopePairsHaveSignal(pairs),
    };
  };

  return {
    histSourceList,
    displayAudio: resolved.displayAudio,
    hasHistoryData: resolved.hasHistoryData,
    correlation: resolved.correlation,
    channelMetadata: resolved.channelMetadata,
    targetTimestampMs: resolved.targetTimestampMs,
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
  };
}
