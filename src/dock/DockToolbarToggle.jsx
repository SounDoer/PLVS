import { ChevronDown, ChevronUp } from "lucide-react";
import { IconButton } from "../components/IconButton.jsx";
import { cn } from "@/lib/utils";

/**
 * The strip's persistent entry to the Dock toolbar. Sized in Dock's own px, not the shell control
 * tokens: the strip's WebView follows Interface Size and the meters beside this do not.
 *
 * @param {{ edge: string, open: boolean, onToggle?: () => void }} props
 */
export function DockToolbarToggle({ edge, open, onToggle }) {
  // Towards where the toolbar will appear while closed, back at the strip while open.
  const direction = (edge === "bottom") !== open ? "up" : "down";
  const Icon = direction === "up" ? ChevronUp : ChevronDown;
  const tip = open ? "Hide Toolbar" : "Show Toolbar";
  return (
    <IconButton
      icon={<Icon className="size-3" data-direction={direction} />}
      tip={tip}
      tipSide="left"
      aria-label={tip.toLowerCase()}
      aria-pressed={open}
      onClick={onToggle}
      className={cn(
        "h-full w-[var(--ui-dock-toolbar-toggle-w)]",
        open && "bg-ui-hover text-foreground"
      )}
    />
  );
}
