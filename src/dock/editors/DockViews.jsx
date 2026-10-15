import { FocusSwitch } from "../../components/FocusViewPopover.jsx";
import { Label } from "../../components/ui/label";
import { useState } from "react";
import { SettingsSelect } from "../../components/panel-settings/SettingsWidgets.jsx";
import { DockEditorShell } from "./DockEditorShell.jsx";

export function DockViews({ state, onAction }) {
  const [positionOpen, setPositionOpen] = useState(false);
  const positions = [
    { key: "off", label: "Off" },
    { key: "top", label: "Top" },
    { key: "bottom", label: "Bottom" },
  ];
  const supportsReservation = /Win|Mac/i.test(navigator.platform || navigator.userAgent || "");
  return (
    <DockEditorShell title="Views">
      <div className="grid gap-1 p-1">
        <FocusSwitch
          id="dock-hide-axes-labels"
          label="Hide Axes & Labels"
          checked={state.hideAxesAndLabels === true}
          onCheckedChange={(value) => onAction("set-hide-axes-labels", { value })}
        />
        <div className="flex items-center justify-between gap-3 px-2 py-1">
          <Label className="min-w-0 text-[length:var(--ui-fs-control)] font-normal text-foreground">
            Dock
          </Label>
          <SettingsSelect
            label={positions.find((position) => position.key === state.edge)?.label ?? "Bottom"}
            ariaLabel="Dock position"
            options={positions}
            value={state.edge}
            open={positionOpen}
            onOpenChange={setPositionOpen}
            onChange={(edge) =>
              edge === "off" ? onAction("restore-window") : onAction("set-edge", { edge })
            }
          />
        </div>
        {supportsReservation && (
          <FocusSwitch
            id="dock-reserve-space"
            label="Reserve Space"
            checked={state.reserveSpace === true}
            onCheckedChange={() => onAction("toggle-reserve-space")}
          />
        )}
      </div>
    </DockEditorShell>
  );
}
