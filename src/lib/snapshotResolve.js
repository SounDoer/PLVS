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

function lengthOf(entries) {
  return entries ? entries.length : 0;
}

function timestampAt(entries, i) {
  if (!entries) return undefined;
  if (typeof entries.timestampAt === "function") return entries.timestampAt(i);
  return entries[i]?.timestampMs;
}

function hasTimestampEntries(entries) {
  return lengthOf(entries) > 0 && Number.isFinite(timestampAt(entries, 0));
}

export function nearestTimestampIndex(entries, targetMs) {
  if (!hasTimestampEntries(entries) || !Number.isFinite(targetMs)) return -1;
  let bestIdx = 0;
  let bestDistance = Math.abs(timestampAt(entries, 0) - targetMs);
  for (let i = 1; i < lengthOf(entries); i += 1) {
    const distance = Math.abs(timestampAt(entries, i) - targetMs);
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
 * History belongs to request keys with no backfill: a request collects history only while it is
 * active and stops when it goes inactive. Switching back and forth between views leaves a single
 * key's history with internal gaps (active stretches separated by spans the other views owned).
 * So the request existed at the selected time only if there is an entry near it — checking the
 * outer [first, last] bounds is not enough, because a selected time can land in an interior gap.
 *
 * The nearest entry must sit within toleranceMs of the target; otherwise the request was inactive
 * then (before its first entry, after its last, or inside a gap) and the caller should show
 * "No data for this view at selected time".
 *
 * @param {object[]|object} entries per-key visual rows (array or view with timestampAt/length)
 * @param {number} targetTimestampMs selected snapshot time; non-finite => latest entry
 * @param {number} toleranceMs slack (≈ one visual sample) to absorb tick jitter
 * @returns {{ index: number, missing: boolean }}
 */
export function resolveKeyedVisualIndex(entries, targetTimestampMs, toleranceMs = 0) {
  if (!hasTimestampEntries(entries)) return { index: -1, missing: true };
  if (!Number.isFinite(targetTimestampMs)) return { index: lengthOf(entries) - 1, missing: false };
  const index = nearestTimestampIndex(entries, targetTimestampMs);
  if (index < 0 || Math.abs(timestampAt(entries, index) - targetTimestampMs) > toleranceMs) {
    return { index: -1, missing: true };
  }
  return { index, missing: false };
}

/**
 * @param {object} view
 * @param {number} view.selectedOffset seconds back from live; < 0 means live (no snapshot)
 * @param {number} view.sampleSec hist-rate sample period
 * @param {object[]} view.histSourceList loudness hist rows (carry timestampMs)
 * @param {object[]} view.audioList per-tick audio snaps (hist rate)
 * @param {number[]} view.corrList per-tick correlation (hist rate)
 * @param {object[]} view.channelMetadataList per-tick channel metadata (hist rate)
 * @param {object} view.liveAudio live audio fallback
 */
export function resolveSnapshot(view) {
  const {
    selectedOffset,
    sampleSec,
    histSourceList,
    audioList,
    corrList,
    channelMetadataList,
    liveAudio,
  } = view;

  const targetTimestampMs =
    selectedOffset >= 0 && hasTimestampEntries(histSourceList)
      ? histSourceList[histSourceList.length - 1].timestampMs - selectedOffset * 1000
      : null;

  const selectedHistSteps =
    selectedOffset >= 0 ? Math.max(0, Math.round(selectedOffset / sampleSec)) : -1;
  const fallbackSnapIdx =
    selectedHistSteps >= 0 ? Math.max(0, histSourceList.length - 1 - selectedHistSteps) : -1;
  const snapIdx =
    targetTimestampMs != null
      ? nearestTimestampIndex(histSourceList, targetTimestampMs)
      : fallbackSnapIdx;

  const audioSnapIdx = snapIdx >= 0 ? Math.min(audioList.length - 1, snapIdx) : -1;

  const displayAudio =
    audioSnapIdx >= 0 && audioList[audioSnapIdx] ? audioList[audioSnapIdx] : liveAudio;
  const correlation =
    snapIdx >= 0 && Number.isFinite(corrList[snapIdx])
      ? corrList[snapIdx]
      : displayAudio.correlation;
  const channelMetadata =
    snapIdx >= 0 && channelMetadataList[snapIdx] ? channelMetadataList[snapIdx] : null;

  return {
    snapIdx,
    targetTimestampMs,
    displayAudio,
    correlation,
    channelMetadata,
    hasHistoryData: histSourceList.length > 0,
  };
}
