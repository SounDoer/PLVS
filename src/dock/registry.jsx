import { DockVectorscope } from "./modules/DockVectorscope.jsx";
import { DockLevel } from "./modules/DockLevel.jsx";
import { DockLoudness } from "./modules/DockLoudness.jsx";
import { DockSpectrogram } from "./modules/DockSpectrogram.jsx";
import { DockSpectrum } from "./modules/DockSpectrum.jsx";
import { DockStats } from "./modules/DockStats.jsx";
import { DockTransport } from "./modules/DockTransport.jsx";
import { DockWaveform } from "./modules/DockWaveform.jsx";
import { getDockPanelSizing } from "./dockPanelSizing.js";

/**
 * Catalog of dock modules. `flexible` entries absorb remaining strip width;
 * fixed entries keep their natural width. Adding a later-phase module is one
 * entry here + one component (plus its id in dockLayout.js).
 */
export const DOCK_MODULE_REGISTRY = {
  level: {
    id: "level",
    label: "Level",
    Component: DockLevel,
    ...getDockPanelSizing("levelMeter"),
    settingsFamily: "level",
  },
  loudness: {
    id: "loudness",
    label: "Loudness",
    Component: DockLoudness,
    ...getDockPanelSizing("loudness"),
    settingsFamily: "loudness",
  },
  spectrum: {
    id: "spectrum",
    label: "Spectrum",
    Component: DockSpectrum,
    ...getDockPanelSizing("spectrum"),
    settingsFamily: "spectrum",
  },
  correlation: {
    id: "correlation",
    label: "Vectorscope",
    Component: DockVectorscope,
    ...getDockPanelSizing("vectorscope"),
    settingsFamily: "correlation",
  },
  stats: {
    id: "stats",
    label: "Stats",
    Component: DockStats,
    ...getDockPanelSizing("stats"),
    settingsFamily: "stats",
  },
  waveform: {
    id: "waveform",
    label: "Waveform",
    Component: DockWaveform,
    ...getDockPanelSizing("waveform"),
    settingsFamily: "waveform",
  },
  spectrogram: {
    id: "spectrogram",
    label: "Spectrogram",
    Component: DockSpectrogram,
    ...getDockPanelSizing("spectrogram"),
    settingsFamily: "spectrogram",
  },
  transport: {
    id: "transport",
    label: "Timecode",
    Component: DockTransport,
    ...getDockPanelSizing("transport"),
    settingsFamily: null,
  },
};
