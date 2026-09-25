import { buildStatsMetrics } from "../lib/statsCatalog.js";

const noop = () => {};

function keyed(value) {
  return new Proxy(Object.create(null), { get: () => value });
}

function spectrumResult() {
  const bandCentersHz = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const smoothDb = [-58, -47, -38, -31, -28, -30, -35, -42, -51, -63];
  return {
    bandCentersHz,
    smoothDb,
    peakDb: smoothDb.map((value) => value + 4),
    smoothDbB: smoothDb.map((value, index) => value - 3 + (index % 2)),
    peakDbB: smoothDb.map((value) => value + 1),
  };
}

export function buildCommunityPreviewFixtureValues(fixture) {
  const frame = fixture.measurementFrame;
  const displayAudio = {
    peakDb: frame.peaksDbfs,
    rmsDb: frame.rmsDbfs,
    momentary: frame.loudness.momentaryLufs,
    shortTerm: frame.loudness.shortTermLufs,
    integrated: frame.loudness.integratedLufs,
    mMax: -15.5,
    stMax: -17.5,
    lra: frame.loudness.rangeLu,
    tpMax: frame.loudness.truePeakDbtp,
    correlation: 0.78,
    sideToMidDb: -8.2,
    loudnessLayoutKnown: true,
    spectrumResultsByKey: keyed(spectrumResult()),
    vectorscopeResultsByKey: keyed({
      path: "M 250 440 C 330 330 420 285 500 80 C 555 270 650 350 750 440",
      correlation: 0.78,
      pairX: 0,
      pairY: 1,
    }),
    stereoMapResultsByKey: keyed({
      bands: [
        { frequencyHz: 125, value: -0.35, energy: 0.65 },
        { frequencyHz: 500, value: -0.1, energy: 0.82 },
        { frequencyHz: 2000, value: 0.18, energy: 0.74 },
        { frequencyHz: 8000, value: 0.42, energy: 0.48 },
      ],
    }),
  };
  const histSourceList = fixture.loudnessHistory.map((row) => ({
    timestampMs: row.atMs,
    m: row.momentaryLufs,
    st: row.shortTermLufs,
    min: [-0.25, -0.2],
    max: [0.25, 0.2],
  }));
  const totalSamples = histSourceList.length;
  return {
    frameData: {
      displayAudio,
      channelCount: frame.channelCount,
      peakLabelContext: { labels: fixture.audio.channelLabels },
      hasTpMaxValue: true,
      onResetTpMax: noop,
      correlation: displayAudio.correlation,
      vectorscopePairX: 0,
      vectorscopePairY: 1,
      spectrumChannelOptions: fixture.audio.channelLabels.map((label, value) => ({ label, value })),
      vsGridDiagInset: 0.18,
      vsGridDiagFar: 0.82,
    },
    metricsData: {
      statsMetrics: buildStatsMetrics(displayAudio),
      dialogueActiveNow: false,
    },
    historyData: {
      hasHistoryData: true,
      historyChartInteractive: false,
      running: false,
      selectedOffset: -1,
      setSelectedOffset: noop,
      holdHistoryHud: noop,
      showHistoryHud: false,
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
      sourceMode: "file",
      frequencyMarkerRef: { current: null },
      frequencyMarkerIndex: -1,
      getSpectrogramSnapsForKey: () => [],
      snapshotSpectrumByKey: {},
      resolveSpectrumSnapshotForKey: () => null,
      resolveVectorscopeSnapshotForKey: () => null,
      resolveStereoMapSnapshotForKey: () => null,
      getVectorscopeHistoryForKey: () => [],
      getStereoMapHistoryForKey: () => [],
      captureCurrentSnapshot: noop,
      visualWaveformHist: histSourceList,
      waveformHistoryIndex: null,
    },
  };
}
