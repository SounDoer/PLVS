import {
  Activity,
  AudioLines,
  AudioWaveform,
  BarChart2,
  Crosshair,
  Layers,
  List,
  Radar,
} from "lucide-react";
import { LevelMeterPanel } from "../components/panels/LevelMeterPanel";
import { LoudnessPanel } from "../components/panels/LoudnessPanel";
import { StatsPanel } from "../components/panels/StatsPanel";
import { VectorscopePanel } from "../components/panels/VectorscopePanel";
import { SpectrumPanel } from "../components/panels/SpectrumPanel";
import { SpectrogramPanel } from "../components/panels/SpectrogramPanel";
import { WaveformPanel } from "../components/panels/WaveformPanel";
import { StereoMapPanel } from "../components/panels/StereoMapPanel";
import { MODULE_CATALOG } from "./moduleCatalog.js";
import { resolvePanelModuleId } from "./panelInstances.js";

/** @type {Record<import('./types.js').ModuleId, { id: string, title: string, minWidth: number, minHeight: number, Component: React.FC<{compact?: boolean}>, Icon: React.FC }>} */
export const MODULE_REGISTRY = {
  levelMeter: { ...MODULE_CATALOG.levelMeter, Component: LevelMeterPanel, Icon: BarChart2 },
  loudness: { ...MODULE_CATALOG.loudness, Component: LoudnessPanel, Icon: Activity },
  stats: { ...MODULE_CATALOG.stats, Component: StatsPanel, Icon: List },
  vectorscope: { ...MODULE_CATALOG.vectorscope, Component: VectorscopePanel, Icon: Crosshair },
  spectrum: { ...MODULE_CATALOG.spectrum, Component: SpectrumPanel, Icon: AudioLines },
  spectrogram: { ...MODULE_CATALOG.spectrogram, Component: SpectrogramPanel, Icon: Layers },
  waveform: { ...MODULE_CATALOG.waveform, Component: WaveformPanel, Icon: AudioWaveform },
  "stereo-map": { ...MODULE_CATALOG["stereo-map"], Component: StereoMapPanel, Icon: Radar },
};

/**
 * The one panel lookup that needs the React half of a module. It lives here rather than beside its
 * siblings in `panelInstances.js` so that file stays free of the panel components — an import there
 * is paid by every logic-only module that touches panel state.
 */
export function resolvePanelDefinition(state, panelId) {
  const moduleId = resolvePanelModuleId(state, panelId);
  return moduleId ? MODULE_REGISTRY[moduleId] : null;
}
