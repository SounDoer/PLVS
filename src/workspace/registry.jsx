import { Activity, AudioLines, BarChart2, Crosshair, Layers, List } from 'lucide-react';
import { PeakPanel } from '../components/panels/PeakPanel';
import { LoudnessPanel } from '../components/panels/LoudnessPanel';
import { LoudnessStatsPanel } from '../components/panels/LoudnessStatsPanel';
import { VectorscopePanel } from '../components/panels/VectorscopePanel';
import { SpectrumPanel } from '../components/panels/SpectrumPanel';
import { SpectrogramPanel } from '../components/panels/SpectrogramPanel';

/** @type {Record<import('./types.js').ModuleId, { id: string, title: string, minWidth: number, minHeight: number, Component: React.FC<{compact:boolean}>, Icon: React.FC }>} */
export const MODULE_REGISTRY = {
  peak: {
    id: 'peak',
    title: 'Peak',
    minWidth: 140,
    minHeight: 200,
    Component: PeakPanel,
    Icon: () => <BarChart2 size={16} />,
  },
  loudness: {
    id: 'loudness',
    title: 'Loudness',
    minWidth: 320,
    minHeight: 200,
    Component: LoudnessPanel,
    Icon: () => <Activity size={16} />,
  },
  loudnessStats: {
    id: 'loudnessStats',
    title: 'Loudness Stats',
    minWidth: 160,
    minHeight: 200,
    Component: LoudnessStatsPanel,
    Icon: () => <List size={16} />,
  },
  vectorscope: {
    id: 'vectorscope',
    title: 'Vectorscope',
    minWidth: 180,
    minHeight: 200,
    Component: VectorscopePanel,
    Icon: () => <Crosshair size={16} />,
  },
  spectrum: {
    id: 'spectrum',
    title: 'Spectrum',
    minWidth: 280,
    minHeight: 180,
    Component: SpectrumPanel,
    Icon: () => <AudioLines size={16} />,
  },
  spectrogram: {
    id: 'spectrogram',
    title: 'Spectrogram',
    minWidth: 320,
    minHeight: 160,
    Component: SpectrogramPanel,
    Icon: () => <Layers size={16} />,
  },
};
