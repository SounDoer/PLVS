export function mapHistoryViewportToVisual({
  historyEntries,
  visualEntries,
  totalHistorySamples,
  totalVisualSamples,
  effectiveOffsetSamples,
  visibleSamples,
}) {
  if (hasTimestamps(historyEntries) && hasTimestamps(visualEntries)) {
    return mapByTimestamp({
      historyEntries,
      visualEntries,
      effectiveOffsetSamples,
      visibleSamples,
    });
  }

  const historyTotal = Math.max(0, totalHistorySamples || 0);
  const visualTotal = Math.max(0, totalVisualSamples || 0);
  if (historyTotal === 0 || visualTotal === 0) {
    return { effectiveOffsetSamples: 0, visibleSamples: 0 };
  }

  const scale = visualTotal / historyTotal;
  const requestedVisibleSamples = Math.round(Math.max(1, visibleSamples || 0) * scale);
  const visualVisibleSamples = Math.max(
    1,
    historyTotal < Math.max(1, visibleSamples || 0)
      ? requestedVisibleSamples
      : Math.min(visualTotal, requestedVisibleSamples)
  );
  const maxOffsetSamples = Math.max(0, visualTotal - visualVisibleSamples);
  const visualOffsetSamples = Math.max(
    0,
    Math.min(maxOffsetSamples, Math.round(Math.max(0, effectiveOffsetSamples || 0) * scale))
  );

  return {
    effectiveOffsetSamples: visualOffsetSamples,
    visibleSamples: visualVisibleSamples,
  };
}

function hasTimestamps(entries) {
  return Array.isArray(entries) && entries.length > 0 && Number.isFinite(entries[0]?.timestampMs);
}

function mapByTimestamp({ historyEntries, visualEntries, effectiveOffsetSamples, visibleSamples }) {
  const historyTotal = historyEntries.length;
  const visualTotal = visualEntries.length;
  const newestHistoryIdx = Math.max(
    0,
    Math.min(historyTotal - 1, historyTotal - 1 - Math.max(0, effectiveOffsetSamples || 0))
  );
  const requestedHistorySamples = Math.max(1, visibleSamples || 0);
  const oldestHistoryIdx = Math.max(0, newestHistoryIdx - requestedHistorySamples + 1);
  const oldestMs = historyEntries[oldestHistoryIdx].timestampMs;
  const newestMs = historyEntries[newestHistoryIdx].timestampMs;

  let startIdx = -1;
  let endIdx = -1;
  for (let i = 0; i < visualTotal; i++) {
    const ts = visualEntries[i]?.timestampMs;
    if (!Number.isFinite(ts)) continue;
    if (ts < oldestMs || ts > newestMs) continue;
    if (startIdx < 0) startIdx = i;
    endIdx = i;
  }

  if (startIdx < 0 || endIdx < startIdx) {
    return { effectiveOffsetSamples: 0, visibleSamples: 0 };
  }

  const mappedVisibleSamples = endIdx - startIdx + 1;
  const visualVisibleSamples =
    historyTotal < requestedHistorySamples
      ? Math.max(
          mappedVisibleSamples,
          Math.round(requestedHistorySamples * (visualTotal / historyTotal))
        )
      : mappedVisibleSamples;

  return {
    effectiveOffsetSamples: Math.max(0, visualTotal - 1 - endIdx),
    visibleSamples: visualVisibleSamples,
  };
}
