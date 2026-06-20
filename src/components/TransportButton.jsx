import { Play, Square, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

const STATE_CONFIG = {
  ready: {
    className: "bg-primary text-primary-foreground hover:brightness-[1.08]",
    Icon: Play,
    label: "START",
  },
  live: {
    className:
      "bg-transparent text-[color:var(--ui-signal-bad)] border border-[color:color-mix(in_srgb,var(--ui-signal-bad)_40%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--ui-signal-bad)_8%,transparent)]",
    Icon: Square,
    label: "STOP",
  },
  snapshot: {
    className: "bg-transparent text-amber-400 border border-amber-400/40 hover:bg-amber-400/8",
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
      <Icon className="size-[10px]" />
      {label}
    </button>
  );
}
