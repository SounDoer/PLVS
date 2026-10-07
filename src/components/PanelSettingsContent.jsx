import { LevelMeterSettings } from "./panel-settings/LevelMeterSettings.jsx";
import { LoudnessSettings } from "./panel-settings/LoudnessSettings.jsx";
import { SpectrumSettings } from "./panel-settings/SpectrumSettings.jsx";
import { StatsSettings } from "./panel-settings/StatsSettings.jsx";
import { StereoMapSettings } from "./panel-settings/StereoMapSettings.jsx";
import { VectorscopeSettings } from "./panel-settings/VectorscopeSettings.jsx";
import { WaveformSettings } from "./panel-settings/WaveformSettings.jsx";

export {
  LoudnessSettingsRows,
  SpectrumDisplaySettingsRows,
  StatsMetricsSettingsRow,
  WaveformSettingsRows,
} from "./panel-settings/PanelSettingsControls.jsx";
export {
  SettingsGroup,
  SettingsNumberInput,
  SettingsRangeInput,
  SettingsRow,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
  SettingsThresholdInputs,
} from "./panel-settings/SettingsWidgets.jsx";

/** @param {import("./panel-settings/types.js").PanelSettingsProps} props */
export function PanelSettingsContent(props) {
  switch (props.activeTab) {
    case "levelMeter":
      return <LevelMeterSettings {...props} />;
    case "waveform":
      return <WaveformSettings {...props} />;
    case "stats":
      return <StatsSettings {...props} />;
    case "loudness":
      return <LoudnessSettings {...props} />;
    case "spectrum":
    case "spectrogram":
      return <SpectrumSettings {...props} />;
    case "vectorscope":
      return <VectorscopeSettings {...props} />;
    case "stereo-map":
      return <StereoMapSettings {...props} />;
    default:
      return null;
  }
}
