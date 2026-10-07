import { normalizePanelControls } from "@/lib/panelControls.js";

import {
  PanelControlRows,
  SettingsGroup,
  SettingsRangeInput,
  SettingsRow,
} from "./PanelSettingsControls.jsx";

/** @param {import("./types.js").PanelSettingsProps} props */
export function LevelMeterSettings({ panelControls, onPanelControlsChange }) {
  if (!panelControls || typeof onPanelControlsChange !== "function") return null;

  const normalizedPanelControls = normalizePanelControls(panelControls);
  // Peak and RMS both measure level and share one stored range; Momentary and Short-term
  // measure loudness and share the other. Which pair the row reads and which pair it writes
  // must be the same question, and it is the same question LevelMeterPanel asks.
  const isPeakFamilyMode =
    normalizedPanelControls.levelMeterMode === "peak" ||
    normalizedPanelControls.levelMeterMode === "rms";
  const levelMeterYMinDb = isPeakFamilyMode
    ? normalizedPanelControls.levelMeterYMinDb
    : normalizedPanelControls.loudnessYMinDb;
  const levelMeterYMaxDb = isPeakFamilyMode
    ? normalizedPanelControls.levelMeterYMaxDb
    : normalizedPanelControls.loudnessYMaxDb;

  return (
    <SettingsGroup>
      <PanelControlRows
        tab="levelMeter"
        controls={normalizedPanelControls}
        onChange={onPanelControlsChange}
        slots={{
          // A whole row rather than a control: it names one of two stored ranges depending on
          // the mode, so a single table row would have to carry two pairs of keys.
          levelMeterYMinDb: (
            <SettingsRow label="Level Range">
              <SettingsRangeInput
                minAriaLabel="level meter range min"
                maxAriaLabel="level meter range max"
                minValue={levelMeterYMinDb}
                maxValue={levelMeterYMaxDb}
                onCommit={(newMin, newMax) => {
                  onPanelControlsChange(
                    normalizePanelControls({
                      ...normalizedPanelControls,
                      ...(isPeakFamilyMode
                        ? { levelMeterYMinDb: newMin, levelMeterYMaxDb: newMax }
                        : { loudnessYMinDb: newMin, loudnessYMaxDb: newMax }),
                    })
                  );
                }}
              />
            </SettingsRow>
          ),
        }}
      />
    </SettingsGroup>
  );
}
