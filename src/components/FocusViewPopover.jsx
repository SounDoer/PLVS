import { RangeInput } from "@/components/ui/range-input.jsx";
import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "@/lib/focusView.js";
import { DEFAULT_SURFACE_OPACITY, DEFAULT_GLASS_ENABLED } from "@/settings/defaults.js";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { COMPACT_SWITCH_CLASS, COMPACT_SWITCH_THUMB_CLASS } from "@/components/ui/controlStyles.js";
import { POPOVER_HEADER_CLASS, POPOVER_TITLE_CLASS } from "@/components/ui/surfaceStyles.js";
import { isMacOS, supportsDockMode } from "@/lib/platform.js";

function FocusSwitch({ id, label, checked, onCheckedChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xs px-2 py-1">
      <Label
        htmlFor={id}
        className="min-w-0 text-[length:var(--ui-fs-control)] font-normal text-foreground"
      >
        {label}
      </Label>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className={COMPACT_SWITCH_CLASS}
        thumbClassName={COMPACT_SWITCH_THUMB_CLASS}
      />
    </div>
  );
}

export function FocusViewPopoverContent({
  pinned = false,
  setPinned = () => {},
  focusView = DEFAULT_FOCUS_VIEW,
  setAutoHideControls = () => {},
  setCompactPanels = () => {},
  setBorderless = () => {},
  surfaceOpacity = DEFAULT_SURFACE_OPACITY,
  setSurfaceOpacity = () => {},
  glassEnabled = DEFAULT_GLASS_ENABLED,
  setGlassEnabled = () => {},
  showDock = false,
  dockEdge = null,
  onDockChange = () => {},
  dockDisabled = false,
}) {
  const normalized = normalizeFocusView(focusView);
  const isMac = isMacOS();

  return (
    <div className="grid gap-1">
      <p className={`${POPOVER_HEADER_CLASS} ${POPOVER_TITLE_CLASS}`}>Views</p>
      <FocusSwitch
        id="focus-view-always-on-top"
        label="Always on Top"
        checked={pinned === true}
        onCheckedChange={setPinned}
      />
      <FocusSwitch
        id="focus-view-compact-panels"
        label="Compact Panels"
        checked={normalized.compactPanels}
        onCheckedChange={setCompactPanels}
      />
      <FocusSwitch
        id="focus-view-borderless"
        label="Hide Chrome"
        checked={normalized.borderless}
        onCheckedChange={setBorderless}
      />
      <FocusSwitch
        id="focus-view-auto-hide-controls"
        label="Auto-hide Controls"
        checked={normalized.autoHideControls}
        onCheckedChange={setAutoHideControls}
      />
      <div className="flex items-center justify-between gap-3 rounded-xs px-2 py-1">
        <Label
          htmlFor="surface-opacity"
          className="min-w-0 text-[length:var(--ui-fs-control)] font-normal text-foreground"
        >
          Surface Opacity
        </Label>
        <RangeInput
          valueLabel={`${surfaceOpacity}%`}
          id="surface-opacity"
          aria-label="Surface opacity"
          type="range"
          min={0}
          max={100}
          step={1}
          value={surfaceOpacity}
          onInput={(e) => setSurfaceOpacity(Number(e.target.value))}
          className="plvs-range w-20"
          style={{ "--range-pct": `${surfaceOpacity}%` }}
        />
      </div>
      {isMac ? (
        <FocusSwitch
          id="focus-view-glass"
          label="Glass"
          checked={glassEnabled === true}
          onCheckedChange={setGlassEnabled}
        />
      ) : null}
      {showDock && supportsDockMode() ? (
        <>
          <div className="mx-2 border-t border-border" />
          <div className="flex items-center justify-between gap-3 rounded-xs px-2 py-1">
            <Label
              htmlFor="focus-view-dock"
              className="min-w-0 text-[length:var(--ui-fs-control)] font-normal text-foreground"
            >
              Dock
            </Label>
            <Select
              value={dockEdge ?? "off"}
              onValueChange={(value) => onDockChange(value === "off" ? null : value)}
              disabled={dockDisabled}
            >
              <SelectTrigger
                id="focus-view-dock"
                aria-label="Dock position"
                variant="inline"
                className="min-w-[4.75rem]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="end"
                variant="inline"
                className="[&_[data-slot=select-item]]:pr-8"
              >
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="top">Top</SelectItem>
                <SelectItem value="bottom">Bottom</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}
    </div>
  );
}
