/**
 * Two-timeline snapshot reconciliation, extracted from useSnapshot.
 *
 * History snaps fill at HIST_SAMPLE_SEC (10 Hz); visual snaps at VISUAL_HIST_SAMPLE_SEC
 * (25 Hz). When a history point is selected, each timeline is matched to the selected
 * timestamp independently (or by cadence when entries carry no timestamp). Band centers are
 * session-constant, so taking them from the hist-rate entry while taking dbList from the
 * visual-rate entry is intentional and time-safe.
 *
 * Pure: no React, no FrameIntake, no SVG. The hook builds SVG paths from the returned data
 * and owns the freeze lifecycle.
 */

function hasTimestampEntries(entries) {
  return Array.isArray(entries) && entries.length > 0 && Number.isFinite(entries[0]?.timestampMs);
}

export function nearestTimestampIndex(entries, targetMs) {
  if (!hasTimestampEntries(entries) || !Number.isFinite(targetMs)) return -1;
  let bestIdx = 0;
  let bestDistance = Math.abs(entries[0].timestampMs - targetMs);
  for (let i = 1; i < entries.length; i++) {
    const distance = Math.abs(entries[i].timestampMs - targetMs);
    if (distance <= bestDistance) {
      bestDistance = distance;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Resolve a request-keyed visual history index at the selected snapshot time.
 *
 * History belongs to request keys with no backfill: a request collects history only from the
 * moment it became active and stops collecting when it goes inactive. So a selected timestamp
 * outside that collected interval means the request did not exist then — the caller should show
 * "No data for this view at selected time".
 *
 * @param {object[]} entries per-key visual rows (carry timestampMs)
 * @param {number} targetTimestampMs selected snapshot time; non-finite => latest entry
 * @param {number} toleranceMs slack (≈ one visual sample) to absorb tick jitter at the boundary
 * @returns {{ index: number, missing: boolean }}
 */
export function resolveKeyedVisualIndex(entries, targetTimestampMs, toleranceMs = 0) {
  if (!hasTimestampEntries(entries)) return { index: -1, missing: true };
  if (!Number.isFinite(targetTimestampMs)) return { index: entries.length - 1, missing: false };
  if (targetTimestampMs < entries[0].timestampMs - toleranceMs) {
    return { index: -1, missing: true };
  }
  if (targetTimestampMs > entries[entries.length - 1].timestampMs + toleranceMs) {
    return { index: -1, missing: true };
  }
  return { index: nearestTimestampIndex(entries, targetTimestampMs), missing: false };
}

/**
 * @param {object} view
 * @param {number} view.selectedOffset seconds back from live; < 0 means live (no snapshot)
 * @param {number} view.sampleSec hist-rate sample period
 * @param {number} view.visualSampleSec visual-rate sample period
 * @param {object[]} view.histSourceList loudness hist rows (carry timestampMs)
 * @param {object[]} view.audioList per-tick audio snaps (hist rate)
 * @param {number[]} view.corrList per-tick correlation (hist rate)
 * @param {object[]} view.spectrumDataList per-tick spectrum data (hist rate)
 * @param {object[]} view.channelMetadataList per-tick channel metadata (hist rate)
 * @param {object[]} view.visualSpectrum visual-rate spectrum rows (carry timestampMs, dbList)
 * @param {object[]} view.visualVectorscope visual-rate vectorscope rows (carry timestampMs, pairs)
 * @param {object} view.liveAudio live audio fallback
 * @param {object} view.liveSpectrumData live spectrum data fallback
 */
export function resolveSnapshot(view) {
  const {
    selectedOffset,
    sampleSec,
    visualSampleSec,
    histSourceList,
    audioList,
    corrList,
    spectrumDataList,
    channelMetadataList,
    visualSpectrum,
    visualVectorscope,
    liveAudio,
    liveSpectrumData,
  } = view;

  const targetTimestampMs =
    selectedOffset >= 0 && hasTimestampEntries(histSourceList)
      ? histSourceList[histSourceList.length - 1].timestampMs - selectedOffset * 1000
      : null;

  const selectedHistSteps =
    selectedOffset >= 0 ? Math.max(0, Math.round(selectedOffset / sampleSec)) : -1;
  const fallbackSnapIdx =
    selectedHistSteps >= 0 ? Math.max(0, spectrumDataList.length - 1 - selectedHistSteps) : -1;
  const snapIdx =
    targetTimestampMs != null
      ? nearestTimestampIndex(histSourceList, targetTimestampMs)
      : fallbackSnapIdx;

  const audioSnapIdx = snapIdx >= 0 ? Math.min(audioList.length - 1, snapIdx) : -1;
  const visualSnapIdx =
    targetTimestampMs != null
      ? nearestTimestampIndex(visualSpectrum, targetTimestampMs)
      : selectedOffset >= 0
        ? Math.max(0, visualSpectrum.length - 1 - Math.round(selectedOffset / visualSampleSec))
        : -1;

  const displayAudio =
    audioSnapIdx >= 0 && audioList[audioSnapIdx] ? audioList[audioSnapIdx] : liveAudio;
  const displaySpectrumData =
    snapIdx >= 0 && spectrumDataList[snapIdx] ? spectrumDataList[snapIdx] : liveSpectrumData;
  const correlation =
    snapIdx >= 0 && Number.isFinite(corrList[snapIdx])
      ? corrList[snapIdx]
      : displayAudio.correlation;
  const channelMetadata =
    snapIdx >= 0 && channelMetadataList[snapIdx] ? channelMetadataList[snapIdx] : null;

  let spectrumSnapCenters = null;
  let spectrumSnapDbList = null;
  let spectrumSnapDbListB = null;
  if (visualSnapIdx >= 0 && visualSpectrum[visualSnapIdx]) {
    const snap = visualSpectrum[visualSnapIdx];
    const centerSource = displaySpectrumData;
    spectrumSnapCenters = (centerSource?.bands ?? []).map((b) => b.fCenter);
    spectrumSnapDbList = snap.dbList ?? [];
    spectrumSnapDbListB = snap.dbListB ?? [];
  }

  const vectorSnapPairs =
    visualSnapIdx >= 0 && visualVectorscope[visualSnapIdx]
      ? (visualVectorscope[visualSnapIdx].pairs ?? visualVectorscope[visualSnapIdx])
      : null;

  return {
    snapIdx,
    visualSnapIdx,
    targetTimestampMs,
    displayAudio,
    displaySpectrumData,
    correlation,
    channelMetadata,
    hasHistoryData: histSourceList.length > 0,
    spectrumSnapCenters,
    spectrumSnapDbList,
    spectrumSnapDbListB,
    vectorSnapPairs,
  };
}
