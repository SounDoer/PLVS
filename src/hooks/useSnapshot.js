import { useCallback, useMemo, useRef } from "react";
import { VISUAL_HIST_SAMPLE_SEC } from "./useLoudnessHistory.js";
import { buildVectorscopeSvgFromPairs } from "../math/vectorscopeMath.js";
import { buildPolarLevelMaxHoldTable, polarLevelMaxHoldAt } from "../math/vectorscopePolarMath.js";
import { buildSpectrumMaxHoldTable, spectrumMaxHoldAt } from "../math/spectrumMaxHold.js";
import { buildSpectrumSvgFromBandsAndDb } from "../math/spectrumMath.js";
import { deriveStereoMapRow } from "../math/stereoMapMath.js";
import { resolveSnapshot, resolveKeyedVisualIndex } from "../lib/snapshotResolve.js";

const VECTORSCOPE_SIGNAL_FLOOR = 10 ** (-90 / 20);

/** 40 s of visual rows per bucket. See spectrumMaxHoldFor. */
const SPECTRUM_MAX_HOLD_BUCKET_ROWS = 1000;

function vectorscopePairsHaveSignal(pairs) {
  if (!pairs?.length) return false;
  for (const sample of pairs) {
    if (Number.isFinite(sample) && Math.abs(sample) > VECTORSCOPE_SIGNAL_FLOOR) return true;
  }
  return false;
}

function snapshotRows(view) {
  if (!view) return [];
  if (typeof view.toArray === "function") return view.toArray();
  return Array.from(view);
}

function freezeSnapshot(intake, liveAudioFallback) {
  return {
    loudness: snapshotRows(intake.getLoudnessHistory()),
    loudnessDisplayIndex: intake.snapshotLoudnessDisplayIndex?.() ?? null,
    waveformHistoryIndex: intake.snapshotWaveformHistoryIndex?.() ?? null,
    visualWaveform:
      intake.getVisualWaveformHist?.()?.freeze?.() ??
      snapshotRows(intake.getVisualWaveformHist?.()),
    corr: snapshotRows(intake.getCorrSnap()),
    audio: snapshotRows(intake.getAudioSnap()),
    channelMetadata: snapshotRows(intake.getChannelMetadataSnap?.()),
    frequencyMarkerIndex: intake.snapshotSparseFrequencyChannelMarkers?.() ?? null,
    spectrumByKey: intake.snapshotVisualSpectrumByKey?.() ?? {},
    vectorscopeByKey: intake.snapshotVisualVectorscopeByKey?.() ?? {},
    stereoMapByKey: intake.snapshotVisualStereoMapByKey?.() ?? {},
    liveAudioFallback,
  };
}

function resultCacheForKey(cache, key, entries) {
  let record = cache.get(key);
  if (!record || record.entries !== entries) {
    record = { entries, values: new Map() };
    cache.set(key, record);
  }
  return record.values;
}

export function useSnapshot({ selectedOffset, sampleSec, intake, audio }) {
  const isSnapshotSelected = selectedOffset >= 0;
  // Freeze the live rings once on entering snapshot mode; scrubbing within resolves against
  // the frozen copy so ongoing live pushes don't move the displayed point.
  const snapSource = useMemo(
    () => (isSnapshotSelected ? freezeSnapshot(intake, audio) : null),
    // `audio` is intentionally captured only when the snapshot session/source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [intake, isSnapshotSelected]
  );

  const histSourceList = snapSource ? snapSource.loudness : intake.getLoudnessHistory();
  const loudnessDisplayIndex = snapSource
    ? snapSource.loudnessDisplayIndex
    : (intake.getLoudnessDisplayIndex?.() ?? null);
  const waveformHistoryIndex = snapSource
    ? snapSource.waveformHistoryIndex
    : (intake.getWaveformHistoryIndex?.() ?? null);
  const visualWaveformHist = snapSource
    ? snapSource.visualWaveform
    : (intake.getVisualWaveformHist?.() ?? []);
  const resolveLiveAudio = snapSource
    ? (snapSource.audio.at(-1) ?? snapSource.liveAudioFallback)
    : audio;
  const resolved = useMemo(
    () =>
      resolveSnapshot({
        selectedOffset,
        sampleSec,
        histSourceList,
        audioList: snapSource ? snapSource.audio : intake.getAudioSnap(),
        corrList: snapSource ? snapSource.corr : intake.getCorrSnap(),
        channelMetadataList: snapSource
          ? snapSource.channelMetadata
          : (intake.getChannelMetadataSnap?.() ?? []),
        liveAudio: resolveLiveAudio,
      }),
    [selectedOffset, sampleSec, histSourceList, snapSource, resolveLiveAudio, intake]
  );

  // Per-request-key snapshot resolution: each Spectrum/Spectrogram/Vectorscope panel derives its
  // own request key and looks up history for that key at the selected timestamp. A request that did
  // not exist at the selected time resolves to { missing: true } so the panel can show an empty
  // state instead of another request's data.
  const keyToleranceMs = VISUAL_HIST_SAMPLE_SEC * 1000;
  const snapshotSpectrumByKey = snapSource?.spectrumByKey ?? null;
  const keyedResultCache = useMemo(
    () => ({
      snapSource,
      targetTimestampMs: resolved.targetTimestampMs,
      spectrum: new Map(),
      vectorscope: new Map(),
      stereoMap: new Map(),
      stereoMapHold: new Map(),
    }),
    [snapSource, resolved.targetTimestampMs]
  );
  // Cache the Max hold prefix table per frozen vectorscope view. The frozen view is stable for the
  // whole snapshot session, so the O(samples) table build runs once per key; scrubbing then costs a
  // single lookup. Keyed by the view object so a new snapshot session drops the old table via GC.
  const maxHoldTableCacheRef = useRef(new WeakMap());
  const spectrumMaxHoldTableCacheRef = useRef(new WeakMap());
  // Spectrum Max Hold in snapshot mode folds the frozen history up to the selected row (see
  // spectrumMaxHold). One bucket per 40 s of rows: the table stays small enough to keep while a
  // query replays at most a bucket. Built only when a panel with Max Hold on asks, so scrubbing
  // without the feature never pays for it.
  const spectrumMaxHoldFor = useCallback((entries, index) => {
    if (!entries || index < 0) return null;
    const cache = spectrumMaxHoldTableCacheRef.current;
    let table = cache.get(entries);
    if (!table) {
      table = buildSpectrumMaxHoldTable(entries, SPECTRUM_MAX_HOLD_BUCKET_ROWS);
      cache.set(entries, table);
    }
    return spectrumMaxHoldAt(table, index);
  }, []);
  const resolveSpectrumSnapshotForKey = useCallback(
    (key, { withMaxHold = false } = {}) => {
      const entries = snapSource?.spectrumByKey?.[key];
      const targetCache = snapSource
        ? resultCacheForKey(keyedResultCache.spectrum, key, entries)
        : null;
      let optionCache = targetCache?.get(resolved.targetTimestampMs);
      if (optionCache?.has(withMaxHold)) return optionCache.get(withMaxHold);

      const { index, missing } = resolveKeyedVisualIndex(
        entries,
        resolved.targetTimestampMs,
        keyToleranceMs
      );
      let result;
      if (missing) {
        result = { missing: true, path: "", pathB: "", data: null, maxHold: null };
      } else {
        const snap = entries.rowAt(index);
        const centers = (snap.bands ?? []).map((b) => b.fCenter);
        const dbList = snap.dbList ?? [];
        const dbListB = snap.dbListB ?? [];
        result = {
          missing: false,
          path: dbList.length ? buildSpectrumSvgFromBandsAndDb(centers, dbList) : "",
          pathB: dbListB.length ? buildSpectrumSvgFromBandsAndDb(centers, dbListB) : "",
          data: { bands: snap.bands ?? [], dbList, dbListB },
          maxHold: withMaxHold ? spectrumMaxHoldFor(entries, index) : null,
        };
      }
      if (targetCache) {
        if (!optionCache) {
          optionCache = new Map();
          targetCache.set(resolved.targetTimestampMs, optionCache);
        }
        optionCache.set(withMaxHold, result);
      }
      return result;
    },
    [
      keyToleranceMs,
      keyedResultCache.spectrum,
      resolved.targetTimestampMs,
      snapSource,
      spectrumMaxHoldFor,
    ]
  );
  // Polar Level Max hold in snapshot mode is reconstructed from the frozen history up to the
  // selected row (see vectorscopePolarMath). Only built when a Polar Level panel with Max hold on
  // asks for it (withMaxHold), so Lissajous/Sample scrubbing never pays for it.
  const maxHoldEnvelopeFor = useCallback((entries, index) => {
    if (!entries || index < 0) return null;
    const cache = maxHoldTableCacheRef.current;
    let table = cache.get(entries);
    if (!table) {
      table = buildPolarLevelMaxHoldTable(entries);
      cache.set(entries, table);
    }
    return polarLevelMaxHoldAt(table, index);
  }, []);
  const resolveVectorscopeSnapshotForKey = useCallback(
    (key, { withMaxHold = false } = {}) => {
      const entries = snapSource?.vectorscopeByKey?.[key];
      const targetCache = snapSource
        ? resultCacheForKey(keyedResultCache.vectorscope, key, entries)
        : null;
      let optionCache = targetCache?.get(resolved.targetTimestampMs);
      if (optionCache?.has(withMaxHold)) return optionCache.get(withMaxHold);

      const { index, missing } = resolveKeyedVisualIndex(
        entries,
        resolved.targetTimestampMs,
        keyToleranceMs
      );
      let result;
      if (missing) {
        result = {
          missing: true,
          path: "",
          pairs: null,
          correlation: -Infinity,
          maxHold: null,
        };
      } else {
        const snap = typeof entries?.rowAt === "function" ? entries.rowAt(index) : entries[index];
        const pairs = snap?.pairs ?? [];
        result = {
          missing: false,
          path: buildVectorscopeSvgFromPairs(pairs),
          pairs,
          maxHold: withMaxHold ? maxHoldEnvelopeFor(entries, index) : null,
          correlation: Number.isFinite(snap?.correlation) ? snap.correlation : -Infinity,
          sideToMidDb: Number.isFinite(snap?.sideToMidDb) ? snap.sideToMidDb : -Infinity,
          midEnergy: Number.isFinite(snap?.midEnergy) ? snap.midEnergy : 0,
          sideEnergy: Number.isFinite(snap?.sideEnergy) ? snap.sideEnergy : 0,
          hasSignal: vectorscopePairsHaveSignal(pairs),
        };
      }
      if (targetCache) {
        if (!optionCache) {
          optionCache = new Map();
          targetCache.set(resolved.targetTimestampMs, optionCache);
        }
        optionCache.set(withMaxHold, result);
      }
      return result;
    },
    [
      keyToleranceMs,
      keyedResultCache.vectorscope,
      maxHoldEnvelopeFor,
      resolved.targetTimestampMs,
      snapSource,
    ]
  );
  // Stereo Map: select the primitive row for the request key with the same keyed/no-backfill
  // semantics as Spectrum/Vectorscope above, then derive the caller's selected Mode from that one
  // retained row. Mode is a pure frontend projection (see stereoMapMath.js), so switching Mode
  // never changes which row is selected or re-queries history.
  // Hold is reconstructed by walking the retained rows up to the selected one, which is far more
  // expensive than deriving the selected row itself, so it is opt-in (`withHold`) exactly like
  // Polar Level's Max hold above: a panel with Hold switched off must not pay for it on every
  // scrub tick. One summary covers all four Modes and carries no Y range, so it is cached per
  // (key, timestamp) — never per Mode — and two panels differing only in Mode or zoom share it.
  const resolveStereoMapHold = useCallback(
    (key, entries) => {
      if (typeof entries?.holdAtOrBeforeTimestamp !== "function") return null;
      const cache = snapSource
        ? resultCacheForKey(keyedResultCache.stereoMapHold, key, entries)
        : null;
      if (cache?.has(resolved.targetTimestampMs)) return cache.get(resolved.targetTimestampMs);
      const holdResult = entries.holdAtOrBeforeTimestamp(resolved.targetTimestampMs);
      const values = holdResult ? holdResult.values : null;
      cache?.set(resolved.targetTimestampMs, values);
      return values;
    },
    [keyedResultCache.stereoMapHold, resolved.targetTimestampMs, snapSource]
  );
  const resolveStereoMapSnapshotForKey = useCallback(
    (key, mode, range, { withHold = false } = {}) => {
      const entries = snapSource?.stereoMapByKey?.[key];
      const targetCache = snapSource
        ? resultCacheForKey(keyedResultCache.stereoMap, key, entries)
        : null;
      const modeCacheKey = `${mode}|${range?.lowerBound}|${range?.upperBound}`;
      let optionCache = targetCache?.get(resolved.targetTimestampMs);
      let base = optionCache?.get(modeCacheKey);
      if (!base) {
        const { index, missing } = resolveKeyedVisualIndex(
          entries,
          resolved.targetTimestampMs,
          keyToleranceMs
        );
        if (missing) {
          base = { missing: true, mode, bandCentersHz: null, derived: null };
        } else {
          const row = entries.rowAt(index);
          const derived =
            typeof row?.derivedForMode === "function"
              ? row.derivedForMode(mode, range)
              : deriveStereoMapRow(mode, row, range);
          base = derived
            ? { missing: false, mode, bandCentersHz: row.bandCentersHz, derived }
            : { missing: true, mode, bandCentersHz: null, derived: null };
        }
        if (targetCache) {
          if (!optionCache) {
            optionCache = new Map();
            targetCache.set(resolved.targetTimestampMs, optionCache);
          }
          optionCache.set(modeCacheKey, base);
        }
      }

      const holdValues = withHold && !base.missing ? resolveStereoMapHold(key, entries) : null;
      return { ...base, hold: holdValues ? (holdValues[mode] ?? null) : null };
    },
    [
      keyToleranceMs,
      keyedResultCache.stereoMap,
      resolveStereoMapHold,
      resolved.targetTimestampMs,
      snapSource,
    ]
  );

  return {
    histSourceList,
    loudnessDisplayIndex,
    waveformHistoryIndex,
    visualWaveformHist,
    frequencyMarkerIndex: snapSource
      ? snapSource.frequencyMarkerIndex
      : (intake.getSparseFrequencyChannelMarkers?.() ?? null),
    displayAudio: resolved.displayAudio,
    hasHistoryData: resolved.hasHistoryData,
    correlation: resolved.correlation,
    channelMetadata: resolved.channelMetadata,
    targetTimestampMs: resolved.targetTimestampMs,
    snapshotSpectrumByKey,
    resolveSpectrumSnapshotForKey,
    resolveVectorscopeSnapshotForKey,
    resolveStereoMapSnapshotForKey,
  };
}
