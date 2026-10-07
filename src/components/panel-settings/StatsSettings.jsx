import { useState } from "react";
import { GripVertical } from "lucide-react";
import { Reorder, useDragControls } from "framer-motion";

import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "@/lib/panelControls.js";
import { STATS_CANONICAL_ORDER, STATS_OPTIONS } from "@/lib/statsCatalog.js";
import { ResetAction } from "@/components/ResetAction.jsx";

import { PanelControlRows } from "./PanelControlRows.jsx";
import { toggleId } from "./selectionKeys.js";
import {
  InlineDetailTrigger,
  SETTINGS_DETAIL_SURFACE_CLASS,
  SettingsGroup,
  SettingsOptionRow,
  SettingsRow,
  visibleSummary,
} from "./SettingsWidgets.jsx";

function SortableStatRow({ id, label, checked, onToggle }) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      className="group flex min-h-[var(--ui-control-h)] items-center gap-1 rounded-xs px-1 hover:bg-ui-hover"
    >
      <span
        aria-hidden="true"
        onPointerDown={(event) => controls.start(event)}
        className="flex cursor-grab touch-none items-center text-muted-foreground group-hover:text-foreground"
      >
        <GripVertical className="size-3.5" />
      </span>
      <SettingsOptionRow
        role="checkbox"
        aria-checked={checked}
        className="min-w-0 flex-1 px-1 hover:bg-transparent"
        checked={checked}
        onClick={() => onToggle(id)}
      >
        {label}
      </SettingsOptionRow>
    </Reorder.Item>
  );
}

export function SortableStatsList({
  label,
  options,
  orderedIds,
  selectedIds,
  onToggle,
  onReorder,
  onReset,
  showReset = true,
}) {
  const labelById = new Map(options.map((option) => [option.id, option.label]));
  return (
    <div className="flex flex-col gap-0">
      <Reorder.Group
        axis="y"
        values={orderedIds}
        onReorder={onReorder}
        role="group"
        aria-label={label}
        className="flex select-none flex-col gap-0"
      >
        {orderedIds.map((id) => (
          <SortableStatRow
            key={id}
            id={id}
            label={labelById.get(id) ?? id}
            checked={selectedIds.includes(id)}
            onToggle={onToggle}
          />
        ))}
      </Reorder.Group>
      <div className="mt-0 flex justify-end pt-0">
        <ResetAction
          label="Reset stats"
          isDefault={!showReset}
          onReset={onReset}
          confirmLabel="Confirm reset stats"
          cancelLabel="Cancel reset stats"
        />
      </div>
    </div>
  );
}

/**
 * @param {{
 *   visibleIds: any[],
 *   orderedIds: any[],
 *   onToggle: (...args: any[]) => any,
 *   onReorder: (...args: any[]) => any,
 *   onReset?: (...args: any[]) => any,
 *   showReset?: boolean,
 * }} props
 */
export function StatsMetricsSettingsRow({
  visibleIds,
  orderedIds,
  onToggle,
  onReorder,
  onReset,
  showReset = true,
}) {
  const [open, setOpen] = useState(false);

  return (
    <SettingsRow label="Metrics">
      <div className="flex min-w-0 flex-1 flex-col">
        <InlineDetailTrigger
          ariaLabel={open ? "Hide metrics" : "Edit metrics"}
          summary={visibleSummary(visibleIds.length)}
          open={open}
          onToggle={() => setOpen((current) => !current)}
        />
        {open ? (
          <div data-settings-detail-surface className={SETTINGS_DETAIL_SURFACE_CLASS}>
            <SortableStatsList
              label="Metrics"
              options={STATS_OPTIONS}
              orderedIds={orderedIds}
              selectedIds={visibleIds}
              onToggle={onToggle}
              onReorder={onReorder}
              onReset={onReset}
              showReset={showReset}
            />
          </div>
        ) : null}
      </div>
    </SettingsRow>
  );
}

/** @param {import("./types.js").PanelSettingsProps} props */
export function StatsSettings({ panelControls, onPanelControlsChange }) {
  if (!panelControls || typeof onPanelControlsChange !== "function") return null;

  const normalizedPanelControls = normalizePanelControls(panelControls);

  return (
    <SettingsGroup>
      <PanelControlRows
        tab="stats"
        controls={normalizedPanelControls}
        onChange={onPanelControlsChange}
        slots={{
          statsVisibleIds: (
            <StatsMetricsSettingsRow
              visibleIds={normalizedPanelControls.statsVisibleIds}
              orderedIds={normalizedPanelControls.statsOrder}
              onToggle={(id) => {
                onPanelControlsChange(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    statsVisibleIds: toggleId(normalizedPanelControls.statsVisibleIds, id),
                  })
                );
              }}
              onReorder={(nextOrder) => {
                onPanelControlsChange(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    statsOrder: nextOrder,
                  })
                );
              }}
              onReset={() => {
                onPanelControlsChange(
                  normalizePanelControls({
                    ...normalizedPanelControls,
                    statsOrder: [...STATS_CANONICAL_ORDER],
                    statsVisibleIds: [...DEFAULT_PANEL_CONTROLS.statsVisibleIds],
                  })
                );
              }}
            />
          ),
        }}
      />
    </SettingsGroup>
  );
}
