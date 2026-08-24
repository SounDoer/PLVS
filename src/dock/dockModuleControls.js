import {
  DEFAULT_PANEL_CONTROLS,
  normalizePanelControlRange,
  normalizePanelControlValue,
} from "../lib/panelControls.js";

/// The Dock's own readout selector: three states where the Workspace panel has two independent
/// toggles, because the strip has room for one control, not two. No Workspace equivalent, so no
/// row in the control table.
const LEVEL_READOUTS = new Set(["live", "truePeakMax", "playbackMax"]);
const DOCK_MODULE_ID_BY_PANEL_MODULE_ID = Object.freeze({
  levelMeter: "level",
  loudness: "loudness",
  stats: "stats",
  vectorscope: "correlation",
  spectrum: "spectrum",
  spectrogram: "spectrogram",
  waveform: "waveform",
  transport: "transport",
  "stereo-map": "stereoMap",
});

const DEFAULT_DOCK_STATS_VISIBLE_IDS = DEFAULT_PANEL_CONTROLS.statsVisibleIds;
const DEFAULT_DOCK_STATS_ORDER = DEFAULT_PANEL_CONTROLS.statsOrder;

export const DEFAULT_DOCK_CONTROLS_BY_MODULE_ID = Object.freeze({
  level: Object.freeze({
    mode: DEFAULT_PANEL_CONTROLS.levelMeterMode,
    readout: "live",
    showLabels: true,
  }),
  loudness: Object.freeze({
    showReadouts: true,
    loudnessHistoryVisibleLayerIds: Object.freeze([
      ...DEFAULT_PANEL_CONTROLS.loudnessHistoryVisibleLayerIds,
    ]),
    loudnessYMinDb: DEFAULT_PANEL_CONTROLS.loudnessYMinDb,
    loudnessYMaxDb: DEFAULT_PANEL_CONTROLS.loudnessYMaxDb,
  }),
  spectrum: Object.freeze({
    channel: Object.freeze({ ...DEFAULT_PANEL_CONTROLS.spectrumChannel }),
    view: DEFAULT_PANEL_CONTROLS.spectrumView,
    speedPercent: DEFAULT_PANEL_CONTROLS.spectrumSpeedPercent,
    octaveSmoothing: DEFAULT_PANEL_CONTROLS.spectrumOctaveSmoothing,
    tiltDbPerOctave: DEFAULT_PANEL_CONTROLS.spectrumTiltDbPerOctave,
    maxHold: DEFAULT_PANEL_CONTROLS.spectrumMaxHold,
    minFreq: DEFAULT_PANEL_CONTROLS.spectrumXMinFreq,
    maxFreq: DEFAULT_PANEL_CONTROLS.spectrumXMaxFreq,
    minDb: DEFAULT_PANEL_CONTROLS.spectrumYMinDb,
    maxDb: DEFAULT_PANEL_CONTROLS.spectrumYMaxDb,
  }),
  correlation: Object.freeze({
    pair: Object.freeze({ ...DEFAULT_PANEL_CONTROLS.vectorscopePair }),
    mode: DEFAULT_PANEL_CONTROLS.vectorscopeMode,
    polarLevelMaxHold: DEFAULT_PANEL_CONTROLS.vectorscopePolarLevelMaxHold,
  }),
  stats: Object.freeze({
    statsVisibleIds: Object.freeze([...DEFAULT_DOCK_STATS_VISIBLE_IDS]),
    statsOrder: Object.freeze([...DEFAULT_DOCK_STATS_ORDER]),
  }),
  spectrogram: Object.freeze({
    channel: Object.freeze({ ...DEFAULT_PANEL_CONTROLS.spectrumChannel }),
    minFreq: DEFAULT_PANEL_CONTROLS.spectrogramYMinFreq,
    maxFreq: DEFAULT_PANEL_CONTROLS.spectrogramYMaxFreq,
  }),
  stereoMap: Object.freeze({
    pair: Object.freeze({ x: 0, y: 1 }),
    mode: DEFAULT_PANEL_CONTROLS.stereoMapMode,
    hold: DEFAULT_PANEL_CONTROLS.stereoMapHold,
    speedPercent: DEFAULT_PANEL_CONTROLS.stereoMapSpeedPercent,
    octaveSmoothing: DEFAULT_PANEL_CONTROLS.stereoMapOctaveSmoothing,
    minFreq: DEFAULT_PANEL_CONTROLS.stereoMapXMinFreq,
    maxFreq: DEFAULT_PANEL_CONTROLS.stereoMapXMaxFreq,
    monoLossMinDb: DEFAULT_PANEL_CONTROLS.stereoMapMonoLossYMinDb,
    msRatioMinDb: DEFAULT_PANEL_CONTROLS.stereoMapMsRatioYMinDb,
    msRatioMaxDb: DEFAULT_PANEL_CONTROLS.stereoMapMsRatioYMaxDb,
  }),
  waveform: Object.freeze({
    frequencyColor: DEFAULT_PANEL_CONTROLS.waveformFrequencyColor,
    lowMidSplitHz: DEFAULT_PANEL_CONTROLS.waveformLowMidSplitHz,
    midHighSplitHz: DEFAULT_PANEL_CONTROLS.waveformMidHighSplitHz,
    centroid: DEFAULT_PANEL_CONTROLS.waveformCentroid,
  }),
});

export const DOCK_CONTROL_MODULE_IDS = Object.freeze(
  Object.keys(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID)
);

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/// The Dock adds two constraints the Workspace panels leave to clampPanelControls: the indices
/// must be non-negative and distinct. A Dock module has no later clamp against the device's
/// channel count, so a degenerate pair would reach the analysis request as-is.
function dockPair(raw, fallback) {
  const value = normalizePanelControlValue("vectorscopePair", raw);
  if (value.x >= 0 && value.y >= 0 && value.x !== value.y) {
    return { x: Math.floor(value.x), y: Math.floor(value.y) };
  }
  return { ...fallback };
}

/// Same two extra constraints as dockPair, over the channel selection's pair form.
function dockChannel(raw, fallback) {
  const value = normalizePanelControlValue("spectrumChannel", raw);
  if (value.type === "single") {
    return value.ch >= 0 ? { type: "single", ch: Math.floor(value.ch) } : { ...fallback };
  }
  if (value.x >= 0 && value.y >= 0 && value.x !== value.y) {
    return { type: "pair", x: Math.floor(value.x), y: Math.floor(value.y) };
  }
  return { ...fallback };
}

export function normalizeDockStatsVisibleIds(raw) {
  return normalizePanelControlValue("statsVisibleIds", raw);
}

export function normalizeDockStatsOrder(raw) {
  return normalizePanelControlValue("statsOrder", raw);
}

export function normalizeDockModuleControls(moduleId, raw) {
  const defaults = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId];
  if (!defaults) return null;

  switch (moduleId) {
    case "level": {
      const mode = normalizePanelControlValue("levelMeterMode", raw?.mode);
      const legacyReadout = raw?.readout === "peak" ? "live" : raw?.readout;
      let readout = LEVEL_READOUTS.has(legacyReadout) ? legacyReadout : defaults.readout;
      if (mode === "peak" && readout === "playbackMax") readout = "live";
      if (mode !== "peak" && readout === "truePeakMax") readout = "live";
      return {
        mode,
        readout,
        showLabels: bool(raw?.showLabels, bool(raw?.showChannelLabels, defaults.showLabels)),
      };
    }
    case "loudness": {
      const range = normalizePanelControlRange(
        "loudnessYMinDb",
        raw?.loudnessYMinDb,
        raw?.loudnessYMaxDb
      );
      return {
        showReadouts: bool(raw?.showReadouts, defaults.showReadouts),
        loudnessHistoryVisibleLayerIds: normalizePanelControlValue(
          "loudnessHistoryVisibleLayerIds",
          raw?.loudnessHistoryVisibleLayerIds
        ),
        loudnessYMinDb: range.loudnessYMinDb,
        loudnessYMaxDb: range.loudnessYMaxDb,
      };
    }
    case "spectrum": {
      const range = normalizePanelControlRange("spectrumYMinDb", raw?.minDb, raw?.maxDb);
      const freqRange = normalizePanelControlRange("spectrumXMinFreq", raw?.minFreq, raw?.maxFreq);
      return {
        channel: dockChannel(raw?.channel, defaults.channel),
        view: normalizePanelControlValue("spectrumView", raw?.view),
        speedPercent: Math.round(
          normalizePanelControlValue(
            "spectrumSpeedPercent",
            raw?.speedPercent ?? raw?.smoothingPercent
          )
        ),
        octaveSmoothing: normalizePanelControlValue(
          "spectrumOctaveSmoothing",
          raw?.octaveSmoothing
        ),
        tiltDbPerOctave: normalizePanelControlValue(
          "spectrumTiltDbPerOctave",
          raw?.tiltDbPerOctave
        ),
        maxHold: normalizePanelControlValue("spectrumMaxHold", raw?.maxHold ?? raw?.peakHold),
        minFreq: freqRange.spectrumXMinFreq,
        maxFreq: freqRange.spectrumXMaxFreq,
        minDb: range.spectrumYMinDb,
        maxDb: range.spectrumYMaxDb,
      };
    }
    case "correlation":
      return {
        pair: dockPair(raw?.pair, defaults.pair),
        mode: normalizePanelControlValue("vectorscopeMode", raw?.mode),
        // polarLevelMaxHold was polarLevelPeakHold under the Dock's own key names; the row in
        // panelControls.js carries the same rename for the Workspace key.
        polarLevelMaxHold: normalizePanelControlValue(
          "vectorscopePolarLevelMaxHold",
          raw?.polarLevelMaxHold ?? raw?.polarLevelPeakHold
        ),
      };
    case "stats":
      return {
        statsVisibleIds: normalizeDockStatsVisibleIds(raw?.statsVisibleIds),
        statsOrder: normalizeDockStatsOrder(raw?.statsOrder),
      };
    case "spectrogram": {
      const freqRange = normalizePanelControlRange(
        "spectrogramYMinFreq",
        raw?.minFreq,
        raw?.maxFreq
      );
      return {
        channel: dockChannel(raw?.channel, defaults.channel),
        minFreq: freqRange.spectrogramYMinFreq,
        maxFreq: freqRange.spectrogramYMaxFreq,
      };
    }
    case "stereoMap": {
      const freqRange = normalizePanelControlRange("stereoMapXMinFreq", raw?.minFreq, raw?.maxFreq);
      const msRatio = normalizePanelControlRange(
        "stereoMapMsRatioYMinDb",
        raw?.msRatioMinDb,
        raw?.msRatioMaxDb
      );
      return {
        pair: dockPair(raw?.pair, defaults.pair),
        mode: normalizePanelControlValue("stereoMapMode", raw?.mode),
        hold: normalizePanelControlValue("stereoMapHold", raw?.hold),
        speedPercent: Math.round(
          normalizePanelControlValue("stereoMapSpeedPercent", raw?.speedPercent)
        ),
        octaveSmoothing: normalizePanelControlValue(
          "stereoMapOctaveSmoothing",
          raw?.octaveSmoothing
        ),
        minFreq: freqRange.stereoMapXMinFreq,
        maxFreq: freqRange.stereoMapXMaxFreq,
        monoLossMinDb: normalizePanelControlValue("stereoMapMonoLossYMinDb", raw?.monoLossMinDb),
        msRatioMinDb: msRatio.stereoMapMsRatioYMinDb,
        msRatioMaxDb: msRatio.stereoMapMsRatioYMaxDb,
      };
    }
    case "waveform": {
      const splits = normalizePanelControlRange(
        "waveformLowMidSplitHz",
        raw?.lowMidSplitHz,
        raw?.midHighSplitHz
      );
      return {
        frequencyColor: normalizePanelControlValue("waveformFrequencyColor", raw?.frequencyColor),
        lowMidSplitHz: splits.waveformLowMidSplitHz,
        midHighSplitHz: splits.waveformMidHighSplitHz,
        centroid: normalizePanelControlValue("waveformCentroid", raw?.centroid),
      };
    }
    default:
      return null;
  }
}

export function isDefaultDockModuleControls(moduleId, controls) {
  return (
    JSON.stringify(normalizeDockModuleControls(moduleId, controls)) ===
    JSON.stringify(
      normalizeDockModuleControls(moduleId, DEFAULT_DOCK_CONTROLS_BY_MODULE_ID[moduleId])
    )
  );
}

export function normalizeDockControlsByModuleId(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return Object.fromEntries(
    DOCK_CONTROL_MODULE_IDS.map((moduleId) => [
      moduleId,
      normalizeDockModuleControls(moduleId, source[moduleId]),
    ])
  );
}

export function updateDockModuleControls(controlsByModuleId, moduleId, nextControls) {
  if (!DOCK_CONTROL_MODULE_IDS.includes(moduleId)) return controlsByModuleId;
  return {
    ...controlsByModuleId,
    [moduleId]: normalizeDockModuleControls(moduleId, nextControls),
  };
}

export function dockControlModuleIdForPanel(panel) {
  return DOCK_MODULE_ID_BY_PANEL_MODULE_ID[panel?.moduleId] ?? panel?.moduleId ?? null;
}

export function normalizeDockControlsByPanelId(
  panelsById = {},
  rawControlsByPanelId,
  fallbackControlsByModuleId
) {
  const rawByPanel =
    rawControlsByPanelId && typeof rawControlsByPanelId === "object" ? rawControlsByPanelId : {};
  const fallbackByModule =
    fallbackControlsByModuleId && typeof fallbackControlsByModuleId === "object"
      ? fallbackControlsByModuleId
      : {};
  return Object.fromEntries(
    Object.entries(panelsById)
      .map(([panelId, panel]) => {
        const controlModuleId = dockControlModuleIdForPanel(panel);
        if (!DOCK_CONTROL_MODULE_IDS.includes(controlModuleId)) return null;
        const raw = rawByPanel[panelId] ?? fallbackByModule[controlModuleId];
        return [panelId, normalizeDockModuleControls(controlModuleId, raw)];
      })
      .filter(Boolean)
  );
}

export function updateDockPanelControls(controlsByPanelId, panelsById, panelId, nextControls) {
  const controlModuleId = dockControlModuleIdForPanel(panelsById?.[panelId]);
  if (!DOCK_CONTROL_MODULE_IDS.includes(controlModuleId)) return controlsByPanelId;
  return {
    ...controlsByPanelId,
    [panelId]: normalizeDockModuleControls(controlModuleId, nextControls),
  };
}

export function controlsByModuleIdFromPanels(
  panelsById = {},
  panelOrder = [],
  controlsByPanelId = {}
) {
  const result = {};
  for (const panelId of panelOrder) {
    const controlModuleId = dockControlModuleIdForPanel(panelsById[panelId]);
    if (!DOCK_CONTROL_MODULE_IDS.includes(controlModuleId) || result[controlModuleId]) continue;
    result[controlModuleId] = normalizeDockModuleControls(
      controlModuleId,
      controlsByPanelId[panelId]
    );
  }
  return normalizeDockControlsByModuleId(result);
}
