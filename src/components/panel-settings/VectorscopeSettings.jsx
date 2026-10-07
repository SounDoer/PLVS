import { useState } from "react";

import { VECTORSCOPE_MODE_OPTIONS, normalizePanelControls } from "@/lib/panelControls.js";

import {
  getSelectedOption,
  SettingsGroup,
  SettingsRow,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
  vectorscopeKeyFromPair,
} from "./PanelSettingsControls.jsx";

/** @param {import("./types.js").PanelSettingsProps} props */
export function VectorscopeSettings({
  vectorscopeOptions = [],
  vectorscopeValueKey = "",
  vectorscopeDisplayLabel = "",
  onVectorscopeChange,
  panelControls,
  onPanelControlsChange,
}) {
  const [vectorscopeChannelOpen, setVectorscopeChannelOpen] = useState(false);
  const [vectorscopeModeOpen, setVectorscopeModeOpen] = useState(false);
  if (vectorscopeOptions.length === 0) return null;

  const hasPanelControls = panelControls != null;
  const normalizedPanelControls = normalizePanelControls(panelControls);
  const effectiveVectorscopeValueKey =
    (hasPanelControls ? vectorscopeKeyFromPair(normalizedPanelControls.vectorscopePair) : "") ||
    vectorscopeValueKey;
  const { matchedOption, selectedOption } = getSelectedOption(
    vectorscopeOptions,
    effectiveVectorscopeValueKey
  );
  const selectedLabel = hasPanelControls
    ? selectedOption.label
    : matchedOption && vectorscopeDisplayLabel
      ? vectorscopeDisplayLabel
      : selectedOption.label;
  const selectedMode =
    VECTORSCOPE_MODE_OPTIONS.find(
      (option) => option.id === normalizedPanelControls.vectorscopeMode
    ) ?? VECTORSCOPE_MODE_OPTIONS[0];

  return (
    <SettingsGroup>
      {hasPanelControls && typeof onPanelControlsChange === "function" ? (
        <SettingsRow label="Mode">
          <SettingsSelect
            label={selectedMode.label}
            ariaLabel="vectorscope mode"
            options={VECTORSCOPE_MODE_OPTIONS}
            value={selectedMode.id}
            open={vectorscopeModeOpen}
            onOpenChange={setVectorscopeModeOpen}
            onChange={(vectorscopeMode) => {
              onPanelControlsChange(
                normalizePanelControls({ ...normalizedPanelControls, vectorscopeMode })
              );
            }}
          />
        </SettingsRow>
      ) : null}
      <SettingsRow label="Channel Pair">
        <SettingsSelect
          label={selectedLabel}
          ariaLabel="vectorscope channel"
          options={vectorscopeOptions}
          value={selectedOption.key}
          open={vectorscopeChannelOpen}
          onOpenChange={setVectorscopeChannelOpen}
          onChange={(key) => {
            const opt = vectorscopeOptions.find((option) => option.key === key);
            if (opt && typeof onVectorscopeChange === "function") {
              onPanelControlsChange?.(
                normalizePanelControls({
                  ...normalizedPanelControls,
                  vectorscopePair: { x: opt.x, y: opt.y },
                })
              );
              onVectorscopeChange({ x: opt.x, y: opt.y });
            }
          }}
        />
      </SettingsRow>
      {hasPanelControls &&
      typeof onPanelControlsChange === "function" &&
      selectedMode.id === "polarSample" ? (
        <SettingsRow
          label="Persistence"
          tooltip="Controls how long Polar Sample points remain visible. 0 ms shows only the newest samples."
        >
          <SettingsSlider
            ariaLabel="vectorscope polar sample persistence"
            min={0}
            max={1000}
            step={50}
            value={normalizedPanelControls.vectorscopePolarSamplePersistenceMs}
            formatValue={(/** @type {number} */ value) => `${value.toFixed(0)} ms`}
            onCommit={(vectorscopePolarSamplePersistenceMs) => {
              onPanelControlsChange(
                normalizePanelControls({
                  ...normalizedPanelControls,
                  vectorscopePolarSamplePersistenceMs,
                })
              );
            }}
          />
        </SettingsRow>
      ) : null}
      {hasPanelControls &&
      typeof onPanelControlsChange === "function" &&
      selectedMode.id === "polarLevel" ? (
        <SettingsRow label="Max Hold">
          <SettingsSwitch
            aria-label="vectorscope polar level max hold"
            checked={normalizedPanelControls.vectorscopePolarLevelMaxHold}
            onCheckedChange={(vectorscopePolarLevelMaxHold) => {
              onPanelControlsChange(
                normalizePanelControls({
                  ...normalizedPanelControls,
                  vectorscopePolarLevelMaxHold,
                })
              );
            }}
          />
        </SettingsRow>
      ) : null}
    </SettingsGroup>
  );
}
