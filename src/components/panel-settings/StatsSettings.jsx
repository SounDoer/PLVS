import { useState } from "react";
import { DragHandle } from "@/components/ui/drag-handle";
import { SortableList } from "@/components/ui/sortable-list.jsx";

import { normalizePanelControls } from "@/lib/panelControls.js";
import { STATS_OPTIONS } from "@/lib/statsCatalog.js";

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

export function SortableStatsList({
  label,
  options,
  orderedIds,
  selectedIds,
  onToggle,
  onReorder,
}) {
  const labelById = new Map(options.map((option) => [option.id, option.label]));
  return (
    <SortableList
      ids={orderedIds}
      onReorder={onReorder}
      role="group"
      aria-label={label}
      className="flex select-none flex-col gap-0"
      renderRow={(id, _index, handle) => {
        const name = labelById.get(id) ?? id;
        const checked = selectedIds.includes(id);
        return (
          <div className="flex min-h-[var(--ui-control-h)] items-center gap-1 rounded-xs px-1 hover:bg-ui-hover">
            <DragHandle aria-label={`Reorder ${name}`} {...handle} />
            <SettingsOptionRow
              role="checkbox"
              aria-checked={checked}
              className="min-w-0 flex-1 px-1 hover:bg-transparent"
              checked={checked}
              onClick={() => onToggle(id)}
            >
              {name}
            </SettingsOptionRow>
          </div>
        );
      }}
    />
  );
}

/**
 * @param {{
 *   visibleIds: any[],
 *   orderedIds: any[],
 *   onToggle: (...args: any[]) => any,
 *   onReorder: (...args: any[]) => any,
 * }} props
 */
export function StatsMetricsSettingsRow({ visibleIds, orderedIds, onToggle, onReorder }) {
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
            />
          ),
        }}
      />
    </SettingsGroup>
  );
}
