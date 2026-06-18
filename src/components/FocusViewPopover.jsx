import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "@/lib/focusView.js";
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
}) {
  const normalized = normalizeFocusView(focusView);

  return (
    <div className="grid gap-1">
      <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
        Focus View
      </p>
      <FocusSwitch
        id="focus-view-always-on-top"
        label="Always on top"
        checked={pinned === true}
        onCheckedChange={setPinned}
      />
      <FocusSwitch
        id="focus-view-auto-hide-controls"
        label="Auto-hide controls"
        checked={normalized.autoHideControls}
        onCheckedChange={setAutoHideControls}
      />
      <FocusSwitch
        id="focus-view-compact-panels"
        label="Compact panels"
        checked={normalized.compactPanels}
        onCheckedChange={setCompactPanels}
      />
    </div>
  );
}
