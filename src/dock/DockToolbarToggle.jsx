import { ChevronDown, ChevronUp } from "lucide-react";
import { IconButton } from "../components/IconButton.jsx";
import { cn } from "@/lib/utils";

/**
 * The strip's persistent entry to the Dock toolbar. The arrow points to where the toolbar will
 * appear while closed and back at the strip while open. Update state is a badge here rather than
 * its own button, so the control column keeps three fixed buttons at the minimum height.
 *
 * @param {{ edge: string, open: boolean, onToggle?: () => void,
 *   update?: { phase: string, label: string } | null }} props
 */
export function DockToolbarToggle({ edge, open, onToggle, update = null }) {
  const direction = (edge === "bottom") !== open ? "up" : "down";
  const Icon = direction === "up" ? ChevronUp : ChevronDown;
  const action = open ? "Hide Toolbar" : "Show Toolbar";
  const tip = update ? `${action} · ${update.label}` : action;
  return (
    <IconButton
      icon={
        <span className="relative inline-flex">
          <Icon className="size-4" data-direction={direction} />
          {update ? (
            <span
              data-testid="dock-update-badge"
              data-phase={update.phase}
              className={cn(
                "absolute -right-[2px] top-1/2 size-1.5 -translate-y-1/2 rounded-full",
                update.phase === "error" ? "bg-[color:var(--ui-feedback-danger)]" : "bg-primary"
              )}
            />
          ) : null}
        </span>
      }
      tip={tip}
      tipSide="left"
      aria-label={tip.toLowerCase()}
      aria-pressed={open}
      onClick={onToggle}
      className={cn("dock-control-button", open && "bg-ui-hover text-foreground")}
    />
  );
}
