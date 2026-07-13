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
  level: { id: "level", label: "Level", Component: DockLevel, flexible: false },
  loudness: { id: "loudness", label: "Loudness", Component: DockLoudness, flexible: false },
  spectrum: { id: "spectrum", label: "Spectrum", Component: DockSpectrum, flexible: true },
  correlation: {
    id: "correlation",
    label: "Correlation",
    Component: DockCorrelation,
    flexible: false,
  },
  stats: { id: "stats", label: "Stats", Component: DockStats, flexible: false },
  waveform: { id: "waveform", label: "Waveform", Component: DockWaveform, flexible: true },
  spectrogram: {
    id: "spectrogram",
    label: "Spectrogram",
    Component: DockSpectrogram,
    flexible: true,
  },
  transport: { id: "transport", label: "Transport", Component: DockTransport, flexible: false },
};
