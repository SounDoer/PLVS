import { normalizePanelControls } from "@/lib/panelControls.js";

import { TimeRangeRow, WaveformSettingsRows } from "./PanelSettingsControls.jsx";
import { SettingsGroup } from "./SettingsWidgets.jsx";

/** @param {import("./types.js").PanelSettingsProps} props */
export function WaveformSettings({ panelControls, onPanelControlsChange }) {
  if (!panelControls || typeof onPanelControlsChange !== "function") return null;

  const normalizedPanelControls = normalizePanelControls(panelControls);
  const updateWaveformControls = (changes) => {
    onPanelControlsChange(
      normalizePanelControls({
        ...normalizedPanelControls,
        ...changes,
      })
    );
  };

  return (
    <SettingsGroup>
      <WaveformSettingsRows
        frequencyColor={normalizedPanelControls.waveformFrequencyColor}
        lowMidSplitHz={normalizedPanelControls.waveformLowMidSplitHz}
        midHighSplitHz={normalizedPanelControls.waveformMidHighSplitHz}
        centroid={normalizedPanelControls.waveformCentroid}
        onFrequencyColorChange={(waveformFrequencyColor) =>
          updateWaveformControls({ waveformFrequencyColor })
        }
        onLowMidSplitChange={(waveformLowMidSplitHz) =>
          updateWaveformControls({ waveformLowMidSplitHz })
        }
        onMidHighSplitChange={(waveformMidHighSplitHz) =>
          updateWaveformControls({ waveformMidHighSplitHz })
        }
        onCentroidChange={(waveformCentroid) => updateWaveformControls({ waveformCentroid })}
      />
      <TimeRangeRow />
    </SettingsGroup>
  );
}
