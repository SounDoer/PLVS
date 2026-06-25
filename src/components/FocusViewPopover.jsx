import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "@/lib/focusView.js";
import { DEFAULT_PANEL_OPACITY } from "@/settings/defaults.js";
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
  panelOpacity = DEFAULT_PANEL_OPACITY,
  setPanelOpacity = () => {},
}) {
  const normalized = normalizeFocusView(focusView);

  return (
    <div className="grid gap-1">
      <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
        Views
      </p>
      <FocusSwitch
        id="focus-view-always-on-top"
        label="Always on top"
        checked={pinned === true}
        onCheckedChange={setPinned}
      />
      <FocusSwitch
        id="focus-view-compact-panels"
        label="Compact panels"
        checked={normalized.compactPanels}
        onCheckedChange={setCompactPanels}
      />
      <FocusSwitch
        id="focus-view-auto-hide-controls"
        label="Auto-hide controls"
        checked={normalized.autoHideControls}
        onCheckedChange={setAutoHideControls}
      />
      <div className="flex items-center justify-between gap-3 rounded px-2 py-1.5">
        <Label htmlFor="panel-opacity" className="min-w-0 text-xs font-normal text-foreground">
          Opacity
        </Label>
        <div className="flex items-center gap-1.5">
          <input
            id="panel-opacity"
            aria-label="Panel opacity"
            type="range"
            min={0}
            max={100}
            step={1}
            value={panelOpacity}
            onInput={(e) => setPanelOpacity(Number(e.target.value))}
            className="h-4 w-20 accent-primary"
          />
          <span className="w-7 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
            {panelOpacity}%
          </span>
        </div>
      </div>
    </div>
  );
}
