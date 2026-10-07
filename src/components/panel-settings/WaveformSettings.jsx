import { normalizePanelControls } from "@/lib/panelControls.js";

import { TimeRangeRow } from "./AxisRangeRows.jsx";
import { PanelControlRows } from "./PanelControlRows.jsx";
import { SettingsGroup, SettingsNumberInput, SettingsRow } from "./SettingsWidgets.jsx";

/**
 * The two band splits. Each input refuses a value on the wrong side of the other, so an
 * out-of-order entry is restored by SettingsNumberInput instead of being silently repaired.
 * @param {{
 *   lowMidSplitHz: number,
 *   midHighSplitHz: number,
 *   onLowMidSplitChange: (value: number) => any,
 *   onMidHighSplitChange: (value: number) => any,
 * }} props
 */
export function WaveformSplitRows({
  lowMidSplitHz,
  midHighSplitHz,
  onLowMidSplitChange,
  onMidHighSplitChange,
}) {
  return (
    <>
      <SettingsRow label="Low / Mid Split">
        <SettingsNumberInput
          ariaLabel="waveform low mid split"
          value={lowMidSplitHz}
          min={20}
          max={20000}
          suffix="Hz"
          onCommit={(/** @type {number} */ nextValue) =>
            nextValue < midHighSplitHz ? onLowMidSplitChange(nextValue) : false
          }
        />
      </SettingsRow>
      <SettingsRow label="Mid / High Split">
        <SettingsNumberInput
          ariaLabel="waveform mid high split"
          value={midHighSplitHz}
          min={20}
          max={20000}
          suffix="Hz"
          onCommit={(/** @type {number} */ nextValue) =>
            nextValue > lowMidSplitHz ? onMidHighSplitChange(nextValue) : false
          }
        />
      </SettingsRow>
    </>
  );
}

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
      <PanelControlRows
        tab="waveform"
        controls={normalizedPanelControls}
        onChange={onPanelControlsChange}
        slots={{
          waveformLowMidSplitHz: (
            <WaveformSplitRows
              lowMidSplitHz={normalizedPanelControls.waveformLowMidSplitHz}
              midHighSplitHz={normalizedPanelControls.waveformMidHighSplitHz}
              onLowMidSplitChange={(waveformLowMidSplitHz) =>
                updateWaveformControls({ waveformLowMidSplitHz })
              }
              onMidHighSplitChange={(waveformMidHighSplitHz) =>
                updateWaveformControls({ waveformMidHighSplitHz })
              }
            />
          ),
          historyWindowSec: <TimeRangeRow />,
        }}
      />
    </SettingsGroup>
  );
}
