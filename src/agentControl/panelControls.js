import { normalizePanelControls } from "../lib/panelControls.js";

export function readPublicPanelControls(moduleId, panelControls, context = {}) {
  const controls = normalizePanelControls(panelControls);

  if (moduleId === "levelMeter") {
    return {
      mode: controls.levelMeterMode,
      playbackMax: controls.levelMeterPlaybackMax,
      floatingValue: controls.levelMeterValueMarker,
      tpMaxMarker: controls.levelMeterTpMaxMarker,
      levelRangeDbfs: {
        min: controls.levelMeterYMinDb,
        max: controls.levelMeterYMaxDb,
      },
      loudnessRangeLufs: {
        min: controls.loudnessYMinDb,
        max: controls.loudnessYMaxDb,
      },
    };
  }

  if (moduleId === "vectorscope") {
    return {
      channelPair: controls.vectorscopePair,
      mode: controls.vectorscopeMode,
      maxHold: controls.vectorscopePolarLevelMaxHold,
    };
  }

  if (moduleId === "spectrum") {
    return {
      channel: controls.spectrumChannel,
      view: controls.spectrumView,
      maxMode: controls.spectrumMaxMode,
      peakLabels: controls.spectrumPeakLabels,
      speedPercent: controls.spectrumSpeedPercent,
      tiltDbPerOctave: controls.spectrumTiltDbPerOctave,
      octaveSmoothing: controls.spectrumOctaveSmoothing,
      levelRangeDb: { min: controls.spectrumYMinDb, max: controls.spectrumYMaxDb },
    };
  }

  if (moduleId === "spectrogram") {
    return {
      channel: controls.spectrumChannel,
      mode: controls.spectrogramMode,
      tiltDbPerOctave: controls.spectrumTiltDbPerOctave,
      octaveSmoothing: controls.spectrumOctaveSmoothing,
      dbFloor: controls.spectrogramDbFloor,
      threeD: {
        azimuthDeg: controls.spectrogram3dAzimuthDeg,
        elevationDeg: controls.spectrogram3dElevationDeg,
        heightScale: controls.spectrogram3dHeightGain,
        colorize: controls.spectrogram3dColorize,
        grid: controls.spectrogram3dFloor,
      },
    };
  }

  if (moduleId === "stereo-map") {
    return {
      mode: controls.stereoMapMode,
      channelPair: controls.stereoMapPair,
      maxHold: controls.stereoMapHold,
      speedPercent: controls.stereoMapSpeedPercent,
      octaveSmoothing: controls.stereoMapOctaveSmoothing,
      monoLossFloorDb: controls.stereoMapMonoLossYMinDb,
      msRatioRangeDb: {
        min: controls.stereoMapMsRatioYMinDb,
        max: controls.stereoMapMsRatioYMaxDb,
      },
    };
  }

  if (moduleId === "waveform") {
    return {
      frequencyColor: controls.waveformFrequencyColor,
      frequencyBandsHz: {
        lowMid: controls.waveformLowMidSplitHz,
        midHigh: controls.waveformMidHighSplitHz,
      },
      centroid: controls.waveformCentroid,
    };
  }

  if (moduleId === "stats") {
    const visible = new Set(controls.statsVisibleIds);
    return {
      metrics: {
        visible: controls.statsOrder.filter((id) => visible.has(id)),
        order: controls.statsOrder,
      },
    };
  }

  if (moduleId === "loudness") {
    const visible = new Set(controls.loudnessHistoryVisibleLayerIds);
    const layers = ["momentary", "shortTerm"]
      .filter((id) => visible.has(id))
      .concat(context.hasLoudnessReference === true && visible.has("ref") ? ["reference"] : []);
    return {
      layers,
      loudnessRangeLufs: { min: controls.loudnessYMinDb, max: controls.loudnessYMaxDb },
    };
  }

  throw new Error(`Unsupported panel module: ${String(moduleId)}.`);
}
