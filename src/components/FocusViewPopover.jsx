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
import { isMacOS, supportsDockMode } from "@/lib/platform.js";

function FocusSwitch({ id, label, checked, onCheckedChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xs px-2 py-1.5">
      <Label
        htmlFor={id}
        className="min-w-0 text-[length:var(--ui-fs-control)] font-normal text-foreground"
      >
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
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
      <p className="px-2 py-1 text-[length:var(--ui-fs-caption)] font-semibold tracking-wide text-muted-foreground">
        Views
      </p>
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
      <div className="flex items-center justify-between gap-3 rounded-xs px-2 py-1.5">
        <Label
          htmlFor="surface-opacity"
          className="min-w-0 text-[length:var(--ui-fs-control)] font-normal text-foreground"
        >
          Surface Opacity
        </Label>
        <input
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
          <div className="mx-2 border-t border-border/60" />
          <div className="flex items-center justify-between gap-3 rounded-xs px-2 py-1.5">
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
                className="h-6 w-auto min-w-[4.75rem] rounded-md border-transparent bg-transparent px-2 py-0 text-[length:var(--ui-fs-control)] shadow-none hover:border-border hover:bg-muted/50"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                align="end"
                className="min-w-[var(--radix-select-trigger-width)] border-border/50 [&_[data-slot=select-item]]:py-1 [&_[data-slot=select-item]]:text-[length:var(--ui-fs-control)]"
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
