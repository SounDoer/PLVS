import { SettingsContent } from "./SettingsContent.jsx";
import { SettingsSheetFrame } from "./settings/SettingsFrames.jsx";

/** The normal-window host; all settings content is shared with other presentations. */
export function SettingsPanel(props) {
  return <SettingsContent {...props} Frame={SettingsSheetFrame} />;
}
