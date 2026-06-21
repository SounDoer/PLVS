import {
  Activity,
  AudioLines,
  AudioWaveform,
  BarChart2,
  Crosshair,
  Layers,
  List,
} from "lucide-react";
import { LevelMeterPanel } from "../components/panels/LevelMeterPanel";
import { LoudnessPanel } from "../components/panels/LoudnessPanel";
import { StatsPanel } from "../components/panels/StatsPanel";
import { VectorscopePanel } from "../components/panels/VectorscopePanel";
import { SpectrumPanel } from "../components/panels/SpectrumPanel";
import { SpectrogramPanel } from "../components/panels/SpectrogramPanel";
import { WaveformPanel } from "../components/panels/WaveformPanel";

/** 拖动 clamp 用的最小尺寸——保证 tab icon 可见，其余内容允许被裁。 */
const MIN_PANEL_WIDTH = 32;
const MIN_PANEL_HEIGHT = 36;

/** @type {Record<import('./types.js').ModuleId, { id: string, title: string, minWidth: number, minHeight: number, Component: React.FC<{compact?: boolean}>, Icon: React.FC }>} */
export const MODULE_REGISTRY = {
  peak: {
    id: "peak",
    title: "Level Meter",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
    Component: LevelMeterPanel,
    Icon: () => <BarChart2 size={16} />,
  },
  loudness: {
    id: "loudness",
    title: "Loudness",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
    Component: LoudnessPanel,
    Icon: () => <Activity size={16} />,
  },
  stats: {
    id: "stats",
    title: "Stats",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
    Component: StatsPanel,
    Icon: () => <List size={16} />,
  },
  vectorscope: {
    id: "vectorscope",
    title: "Vectorscope",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
    Component: VectorscopePanel,
    Icon: () => <Crosshair size={16} />,
  },
  spectrum: {
    id: "spectrum",
    title: "Spectrum",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
    Component: SpectrumPanel,
    Icon: () => <AudioLines size={16} />,
  },
  spectrogram: {
    id: "spectrogram",
    title: "Spectrogram",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
    Component: SpectrogramPanel,
    Icon: () => <Layers size={16} />,
  },
  waveform: {
    id: "waveform",
    title: "Waveform",
    minWidth: MIN_PANEL_WIDTH,
    minHeight: MIN_PANEL_HEIGHT,
    Component: WaveformPanel,
    Icon: () => <AudioWaveform size={16} />,
  },
};
