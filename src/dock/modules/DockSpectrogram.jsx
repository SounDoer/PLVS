import { SpectrogramPanel } from "../../components/panels/SpectrogramPanel.jsx";
import { DockTimelinePanel } from "./DockTimelinePanel.jsx";
export function DockSpectrogram({ controls }) {
  return (
    <DockTimelinePanel moduleId="spectrogram" controls={controls} component={SpectrogramPanel} />
  );
}
