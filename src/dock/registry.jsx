import { DockCorrelation } from "./modules/DockCorrelation.jsx";
import { DockLevel } from "./modules/DockLevel.jsx";
import { DockLoudness } from "./modules/DockLoudness.jsx";
import { DockSpectrogram } from "./modules/DockSpectrogram.jsx";
import { DockSpectrum } from "./modules/DockSpectrum.jsx";
import { DockStats } from "./modules/DockStats.jsx";
import { DockTransport } from "./modules/DockTransport.jsx";
import { DockWaveform } from "./modules/DockWaveform.jsx";

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
    flexible: false,
    settingsFamily: "level",
  },
  loudness: {
    id: "loudness",
    label: "Loudness",
    Component: DockLoudness,
    flexible: false,
    settingsFamily: "loudness",
  },
  spectrum: {
    id: "spectrum",
    label: "Spectrum",
    Component: DockSpectrum,
    flexible: true,
    settingsFamily: "spectrum",
  },
  correlation: {
    id: "correlation",
    label: "Correlation",
    Component: DockCorrelation,
    flexible: false,
    settingsFamily: "correlation",
  },
  stats: {
    id: "stats",
    label: "Stats",
    Component: DockStats,
    flexible: false,
    settingsFamily: "stats",
  },
  waveform: {
    id: "waveform",
    label: "Waveform",
    Component: DockWaveform,
    flexible: true,
    settingsFamily: "waveform",
  },
  spectrogram: {
    id: "spectrogram",
    label: "Spectrogram",
    Component: DockSpectrogram,
    flexible: true,
    settingsFamily: "spectrogram",
  },
  transport: {
    id: "transport",
    label: "Timecode",
    Component: DockTransport,
    flexible: false,
    settingsFamily: null,
  },
};
