import { WaveformPanel } from "../../components/panels/WaveformPanel.jsx";
import { DockTimelinePanel } from "./DockTimelinePanel.jsx";
export function DockWaveform({ controls }) {
  return <DockTimelinePanel moduleId="waveform" controls={controls} component={WaveformPanel} />;
}
