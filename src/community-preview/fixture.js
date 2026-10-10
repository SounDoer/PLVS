import { buildStatsMetrics } from "../lib/statsCatalog.js";
import { deriveStereoMapRow } from "../math/stereoMapMath.js";

const noop = () => {};

function indexedView(rows) {
  return {
    length: rows.length,
    version: 1,
    rowAt: (index) => rows[index],
    timestampAt: (index) => rows[index]?.timestampMs ?? Number.NaN,
  };
}

function vectorscopeHistory(rows) {
  return indexedView(
    rows.map(({ atMs, pairs }) => ({
      timestampMs: atMs,
      pairs: Float32Array.from(pairs),
    }))
  );
}

export function buildCommunityPreviewFixtureValues(fixture, { snapshot = false } = {}) {
  const frame = fixture.measurementFrame;
  const bands = fixture.visuals.bandCentersHz.map((fCenter) => ({ fCenter }));
  const spectrumResultsByKey = Object.fromEntries(
    Object.entries(fixture.visuals.spectrumResultsByKey).map(([key, result]) => [
      key,
      { bandCentersHz: fixture.visuals.bandCentersHz, ...result },
    ])
  );
  const vectorscopeResultsByKey = {};
  const vectorscopeHistoryByKey = {};
  for (const [key, result] of Object.entries(fixture.visuals.vectorscopeResultsByKey)) {
    const history = vectorscopeHistory(result.history);
    vectorscopeResultsByKey[key] = {
      path: result.path,
      correlation: result.correlation,
      sideToMidDb: result.sideToMidDb,
      pairX: result.pairX,
      pairY: result.pairY,
      // The real live panel accumulates this outline frame by frame. A frozen preview mounts only
      // once at the final frame, so seed that same runtime state from the measured history.
      initialMaxHold: result.maxHold?.length ? Float64Array.from(result.maxHold) : null,
    };
    vectorscopeHistoryByKey[key] = history;
  }
  const spectrogramByKey = Object.fromEntries(
    Object.entries(fixture.visuals.spectrogramByKey).map(([key, rows]) => [
      key,
      indexedView(
        rows.map(({ atMs, db }) => ({
          bands,
          dbList: db,
          timestampMs: atMs,
        }))
      ),
    ])
  );
  const displayAudio = {
    peakDb: frame.peaksDbfs,
    rmsDb: frame.rmsDbfs,
    momentary: frame.loudness.momentaryLufs,
    shortTerm: frame.loudness.shortTermLufs,
    integrated: frame.loudness.integratedLufs,
    mMax: frame.mMaxLufs,
    stMax: frame.stMaxLufs,
    lra: frame.loudness.rangeLu,
    tpMax: frame.loudness.truePeakDbtp,
    correlation: frame.correlation,
    sideToMidDb: frame.sideToMidDb,
    loudnessLayoutKnown: true,
    spectrumResultsByKey,
    vectorscopeResultsByKey,
    stereoMapResultsByKey: fixture.visuals.stereoMapResultsByKey,
  };
  const histSourceList = fixture.loudnessHistory.map((row) => ({
    timestampMs: row.atMs,
    m: row.momentaryLufs,
    st: row.shortTermLufs,
    min: row.waveformMin,
    max: row.waveformMax,
    waveformMin: row.waveformMin,
    waveformMax: row.waveformMax,
  }));
  const visualWaveformHist = fixture.visuals.waveform.map((row) => ({
    timestampMs: row.atMs,
    waveformMin: row.min,
    waveformMax: row.max,
    dominantFrequencyHz: row.dominantFrequencyHz,
    spectralCentroidHz: row.spectralCentroidHz,
    tonality: row.tonality,
  }));
  const totalSamples = histSourceList.length;
  const resolveSpectrumSnapshotForKey = (key) => {
    const result = spectrumResultsByKey[key];
    if (!result) return { missing: true, data: null, maxHold: null };
    return {
      missing: false,
      data: {
        bands,
        dbList: result.smoothDb,
        dbListB: result.smoothDbB,
      },
      maxHold: null,
    };
  };
  const resolveVectorscopeSnapshotForKey = (key, { withMaxHold = false } = {}) => {
    const result = vectorscopeResultsByKey[key];
    const history = vectorscopeHistoryByKey[key];
    const lastIndex = (history?.length ?? 0) - 1;
    const pairs = lastIndex >= 0 ? history.rowAt(lastIndex)?.pairs : null;
    if (!result || !pairs?.length) {
      return { missing: true, path: "", pairs: null, correlation: -Infinity, maxHold: null };
    }
    return {
      missing: false,
      ...result,
      pairs,
      hasSignal: pairs.some(
        (sample) => Number.isFinite(sample) && Math.abs(sample) > 10 ** (-90 / 20)
      ),
      maxHold: withMaxHold && result.initialMaxHold ? result.initialMaxHold : null,
    };
  };
  const resolveStereoMapSnapshotForKey = (key, mode, range) => {
    const row = fixture.visuals.stereoMapResultsByKey[key];
    const derived = row ? deriveStereoMapRow(mode, row, range) : null;
    return derived
      ? { missing: false, mode, bandCentersHz: row.bandCentersHz, derived, hold: null }
      : { missing: true, mode, bandCentersHz: null, derived: null, hold: null };
  };
  return {
    frameData: {
      displayAudio,
      channelCount: frame.channelCount,
      peakLabelContext: { labels: fixture.audio.channelLabels },
      hasTpMaxValue: true,
      onResetTpMax: noop,
      correlation: displayAudio.correlation,
      vectorscopePairX: fixture.analysisRequests.vectorscope[0]?.x ?? 0,
      vectorscopePairY: fixture.analysisRequests.vectorscope[0]?.y ?? 1,
      spectrumChannelOptions: fixture.audio.channelLabels.map((label, value) => ({ label, value })),
      vsGridDiagInset: 18,
      vsGridDiagFar: 82,
    },
    metricsData: {
      statsMetrics: buildStatsMetrics(displayAudio),
      dialogueActiveNow: false,
    },
    historyData: {
      hasHistoryData: true,
      historyChartInteractive: false,
      running: true,
      selectedOffset: snapshot ? 0 : -1,
      setSelectedOffset: noop,
      holdHistoryHud: noop,
      showHistoryHud: noop,
      onHistoryWheel: noop,
      onHistoryPointerDown: noop,
      onHistoryPointerMove: noop,
      onHistoryPointerUp: noop,
      historyTimeAxisHandlers: {},
      historyTimeAxisActive: false,
      showSelLine: false,
      selectionEdge: null,
      selLineX: null,
      historyTimeTicks: [],
      effectiveOffsetSec: 0,
      histSourceList,
      loudnessDisplayIndex: null,
      effectiveOffsetSamples: 0,
      visibleSamples: totalSamples,
      totalSamples,
      referenceLufs: null,
      momentaryRules: [],
      shortTermRules: [],
      sourceMode: "live",
      frequencyMarkerRef: { current: null },
      frequencyMarkerIndex: -1,
      getSpectrogramSnapsForKey: (key) => spectrogramByKey[key] ?? indexedView([]),
      snapshotSpectrumByKey: snapshot ? spectrogramByKey : {},
      resolveSpectrumSnapshotForKey,
      resolveVectorscopeSnapshotForKey,
      resolveStereoMapSnapshotForKey,
      getVectorscopeHistoryForKey: (key) => vectorscopeHistoryByKey[key] ?? indexedView([]),
      getStereoMapHistoryForKey: () => null,
      captureCurrentSnapshot: noop,
      visualWaveformHist,
      waveformHistoryIndex: null,
    },
  };
}
