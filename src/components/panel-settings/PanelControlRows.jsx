import { Fragment, useState } from "react";

import {
  DEFAULT_PANEL_CONTROLS,
  normalizePanelControls,
  panelControlUiRows,
} from "@/lib/panelControls.js";
import { axisKindForRangeRow } from "@/workspace/axisViewports.js";

import { AxisViewportRangeInput, RangeRowLinkToggle } from "./AxisRangeRows.jsx";
import {
  SettingsChoiceSelect,
  SettingsRangeInput,
  SettingsResetButton,
  SettingsRow,
  SettingsSelect,
  SettingsSlider,
  SettingsSwitch,
  SettingsThresholdInputs,
} from "./SettingsWidgets.jsx";

/** Widgets the table declares but does not draw: the settings surface passes them in `slots`. */
const SLOT_WIDGETS = new Set(["custom", "customRow"]);

/**
 * Renders the rows one tab owns straight from the control table: the row carries its label,
 * tooltip, widget and visibility rule, and the value and its repair rule come from the same row.
 * Adding a control to the table is what puts it on screen.
 *
 * One `openKey` for the whole group rather than a piece of state per select: only one popover can
 * be open at a time anyway, and a per-row flag would have to be declared next to the widget, which
 * is exactly the second list this is removing.
 *
 * `onChange` receives only the keys a change touches. The record those keys live in is the
 * surface's: a panel's holds every control and is repaired whole, the Dock's holds a module's subset
 * plus keys the table does not know, so each merges and repairs the patch by its own rule.
 * @param {{ rows: ReturnType<typeof panelControlUiRows>, tab: string, controls: Record<string, any>, onChange: (changes: Record<string, any>) => any, slots?: Record<string, import("react").ReactNode> }} props
 */
export function ControlRows({ rows, tab, controls, onChange: commit, slots = {} }) {
  const [openKey, setOpenKey] = useState(null);

  return rows
    .filter((row) => !row.ui.showWhen || row.ui.showWhen(controls))
    .filter((row) => !SLOT_WIDGETS.has(row.ui.widget) || slots[row.key ?? row.minKey])
    .map((row) => {
      const { ui } = row;
      const rowKey = row.key ?? row.minKey;
      // `custom` fills in the control of a row the table labels; `customRow` hands over the row
      // itself, for the ones that carry their own label, link toggle or visibility rule.
      if (ui.widget === "customRow") return <Fragment key={rowKey}>{slots[rowKey]}</Fragment>;
      if (ui.widget === "custom") {
        return (
          <SettingsRow key={rowKey} label={ui.label} tooltip={ui.tooltip}>
            {slots[rowKey]}
          </SettingsRow>
        );
      }
      const action = ui.resettable ? (
        <SettingsResetButton
          ariaLabel={`reset ${ui.ariaLabel}`}
          atDefault={controls[row.key] === DEFAULT_PANEL_CONTROLS[row.key]}
          onReset={() => commit({ [row.key]: DEFAULT_PANEL_CONTROLS[row.key] })}
        />
      ) : null;
      const controlAction = ui.resettable ? null : (
        <RangeRowLinkToggle moduleId={tab} minKey={row.minKey} label={ui.label} />
      );

      return (
        <SettingsRow
          key={rowKey}
          label={ui.label}
          tooltip={ui.tooltip}
          action={action}
          controlAction={controlAction}
        >
          {renderPanelControlWidget(row, tab, controls, commit, openKey, setOpenKey)}
        </SettingsRow>
      );
    });
}

/**
 * A panel's settings tab, straight from the table.
 * @param {{ tab: string, controls: import("../../workspace/types.js").PanelControls, onChange: (...args: any[]) => any, slots?: Record<string, import("react").ReactNode> }} props
 */
export function PanelControlRows({ tab, controls, onChange, slots }) {
  return (
    <ControlRows
      rows={panelControlUiRows(tab)}
      tab={tab}
      controls={controls}
      onChange={(changes) => onChange(normalizePanelControls({ ...controls, ...changes }))}
      slots={slots}
    />
  );
}

function renderPanelControlWidget(row, tab, controls, commit, openKey, setOpenKey) {
  const { ui } = row;
  const rowKey = row.key ?? row.minKey;
  const open = openKey === rowKey;
  const onOpenChange = (next) => setOpenKey(next ? rowKey : null);

  if (ui.widget === "switch") {
    return (
      <SettingsSwitch
        aria-label={ui.ariaLabel}
        checked={controls[row.key]}
        onCheckedChange={(checked) => commit({ [row.key]: checked })}
      />
    );
  }
  if (ui.widget === "select") {
    const selected = ui.options.find((option) => option.id === controls[row.key]) ?? ui.options[0];
    return (
      <SettingsSelect
        label={selected.label}
        ariaLabel={ui.ariaLabel}
        options={ui.options}
        value={selected.id}
        open={open}
        onOpenChange={onOpenChange}
        onChange={(id) => commit({ [row.key]: id })}
      />
    );
  }
  if (ui.widget === "choiceSelect") {
    return (
      <SettingsChoiceSelect
        ariaLabel={ui.ariaLabel}
        options={ui.options}
        value={controls[row.key]}
        open={open}
        onOpenChange={onOpenChange}
        onChange={(id) => commit({ [row.key]: id })}
      />
    );
  }
  if (ui.widget === "slider") {
    return (
      <SettingsSlider
        ariaLabel={ui.ariaLabel}
        min={ui.min ?? row.min}
        max={ui.max ?? row.max}
        step={ui.step}
        value={controls[row.key]}
        formatValue={ui.format}
        onCommit={(value) => commit({ [row.key]: value })}
        commitOnRelease={ui.commitOnRelease === true}
      />
    );
  }
  if (ui.widget === "rangeMin") {
    return (
      <SettingsRangeInput
        minAriaLabel={`${ui.ariaLabel} min`}
        maxAriaLabel={`${ui.ariaLabel} max`}
        minValue={controls[row.key]}
        maxValue={ui.fixedMax}
        onCommit={(newMin) => commit({ [row.key]: newMin })}
      />
    );
  }
  if (ui.widget === "thresholds") {
    return (
      <SettingsThresholdInputs
        ariaLabel={ui.ariaLabel}
        warning={controls[row.minKey]}
        critical={controls[row.maxKey]}
        min={row.absMin}
        max={row.absMax}
        onCommit={(warning, critical) => commit({ [row.minKey]: warning, [row.maxKey]: critical })}
      />
    );
  }
  if (axisKindForRangeRow(tab, row.minKey)) {
    return (
      <AxisViewportRangeInput
        moduleId={tab}
        minKey={row.minKey}
        minAriaLabel={`${ui.ariaLabel} min`}
        maxAriaLabel={`${ui.ariaLabel} max`}
        controls={controls}
        onLocalCommit={(newMin, newMax) => commit({ [row.minKey]: newMin, [row.maxKey]: newMax })}
      />
    );
  }
  return (
    <SettingsRangeInput
      minAriaLabel={`${ui.ariaLabel} min`}
      maxAriaLabel={`${ui.ariaLabel} max`}
      minValue={controls[row.minKey]}
      maxValue={controls[row.maxKey]}
      onCommit={(newMin, newMax) => commit({ [row.minKey]: newMin, [row.maxKey]: newMax })}
    />
  );
}
