import { ChevronDown, ChevronUp } from "lucide-react";
import { IconButton } from "../components/IconButton.jsx";
import { cn } from "@/lib/utils";
import { StatusIcon } from "../components/AppStatus.jsx";

/**
 * The strip's persistent entry to the Dock toolbar. The arrow points to where the toolbar will
 * appear while closed and back at the strip while open. Update state is a badge here rather than
 * its own button, so the control column keeps three fixed buttons at the minimum height.
 *
 * @param {{ edge: string, open: boolean, onToggle?: () => void,
 *   update?: { phase: string, label: string } | null,
 *   statusItems?: import("../lib/appStatus.js").AppStatusItem[] }} props
 */
export function DockToolbarToggle({ edge, open, onToggle, update = null, statusItems = [] }) {
  const direction = (edge === "bottom") !== open ? "up" : "down";
  const Icon = direction === "up" ? ChevronUp : ChevronDown;
  const action = open ? "Hide Toolbar" : "Show Toolbar";
  const firstStatus = statusItems[0];
  const tip = firstStatus
    ? `${action} · ${firstStatus.text}${statusItems.length > 1 ? ` · ${statusItems.length} Notices` : ""}`
    : update
      ? `${action} · ${update.label}`
      : action;
  return (
    <IconButton
      icon={
        <span className="relative inline-flex">
          {/* A chevron's strokes fill little of its box; draw it larger to match the other icons. */}
          {firstStatus && !open ? (
            <StatusIcon
              item={firstStatus}
              className={cn(
                "size-4",
                firstStatus.kind === "error"
                  ? "text-[color:var(--ui-feedback-danger)]"
                  : firstStatus.kind === "warning"
                    ? "text-[color:var(--ui-interface-warning)]"
                    : "text-primary"
              )}
            />
          ) : (
            <Icon
              className="size-5"
              absoluteStrokeWidth
              strokeWidth={1.75}
              data-direction={direction}
            />
          )}
          {update && !firstStatus ? (
            <span
              data-testid="dock-update-badge"
              data-phase={update.phase}
              className={cn(
                "absolute right-[2px] top-[2px] size-1.5 rounded-full",
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
      className="dock-control-button"
    />
  );
}
