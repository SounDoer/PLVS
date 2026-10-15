import { LoudnessPanel } from "../../components/panels/LoudnessPanel.jsx";
import { DockTimelinePanel } from "./DockTimelinePanel.jsx";
export function DockLoudness({ controls }) {
  return <DockTimelinePanel moduleId="loudness" controls={controls} component={LoudnessPanel} />;
}
