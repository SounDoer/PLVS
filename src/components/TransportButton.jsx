import { Play, Square, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

const STATE_CONFIG = {
  ready: {
    className: "bg-primary text-primary-foreground hover:bg-[color:var(--ui-primary-hover)]",
    Icon: Play,
    label: "START",
  },
  live: {
    className:
      "border border-border bg-secondary text-[color:var(--ui-activity-live)] hover:bg-ui-hover",
    Icon: Square,
    label: "STOP",
  },
  snapshot: {
    className:
      "border border-border bg-secondary text-[color:var(--ui-activity-snapshot)] hover:bg-ui-hover",
    Icon: Radio,
    label: "LIVE",
  },
};

/**
 * Transport control button that changes appearance based on recording state.
 *
 * @param {{ state: 'ready' | 'live' | 'snapshot', onClick: () => void }} props
 */
export function TransportButton({ state = "ready", onClick }) {
  const config = STATE_CONFIG[state] ?? STATE_CONFIG.ready;
  const { className, Icon, label } = config;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5",
        "h-8 px-3.5 rounded-md",
        "text-[11.5px] font-bold tracking-[0.06em]",
        "transition-all duration-150",
        className
      )}
    >
      <Icon className="size-[1em]" />
      {label}
    </button>
  );
}
