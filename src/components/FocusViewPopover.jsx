import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "@/lib/focusView.js";
import { DEFAULT_PANEL_OPACITY, DEFAULT_GLASS_ENABLED } from "@/settings/defaults.js";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

function FocusSwitch({ id, label, checked, onCheckedChange }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded px-2 py-1.5">
      <Label htmlFor={id} className="min-w-0 text-xs font-normal text-foreground">
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
  panelOpacity = DEFAULT_PANEL_OPACITY,
  setPanelOpacity = () => {},
  glassEnabled = DEFAULT_GLASS_ENABLED,
  setGlassEnabled = () => {},
}) {
  const normalized = normalizeFocusView(focusView);
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac/i.test(navigator.platform || navigator.userAgent || "");

  return (
    <div className="grid gap-1">
      <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
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
      <div className="flex items-center justify-between gap-3 rounded px-2 py-1.5">
        <Label htmlFor="panel-opacity" className="min-w-0 text-xs font-normal text-foreground">
          Opacity
        </Label>
        <input
          id="panel-opacity"
          aria-label="Panel opacity"
          type="range"
          min={0}
          max={100}
          step={1}
          value={panelOpacity}
          onInput={(e) => setPanelOpacity(Number(e.target.value))}
          className="plvs-range w-20"
          style={{ "--range-pct": `${panelOpacity}%` }}
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
    </div>
  );
}
