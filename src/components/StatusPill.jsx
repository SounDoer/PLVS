import { cn } from "@/lib/utils";

const STATE_CONFIG = {
  ready: {
    bg: "bg-secondary",
    border: "border border-border",
    color: "text-muted-foreground",
    label: "READY",
    showClock: (clock) => clock != null,
    dotPulse: false,
  },
  live: {
    bg: "bg-secondary",
    border: "border border-border",
    color: "text-[color:var(--ui-activity-live)]",
    label: "LIVE",
    showClock: () => true,
    dotPulse: true,
  },
  snapshot: {
    bg: "bg-secondary",
    border: "border border-border",
    color: "text-[color:var(--ui-activity-snapshot)]",
    label: "SNAP",
    showClock: (clock) => clock != null,
    dotPulse: false,
  },
};

export function StatusPill({ state = "ready", showClock = false, clockRef = null }) {
  const cfg = STATE_CONFIG[state] ?? STATE_CONFIG.ready;

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full py-[5px] px-3 transition-all duration-200",
        cfg.bg,
        cfg.border,
        cfg.color
      )}
    >
      <span
        className={cn(
          "w-2 h-2 rounded-full bg-current transition-all duration-200",
          cfg.dotPulse && "status-dot-pulse"
        )}
      />
      <span className="ml-1.5 text-[length:var(--ui-fs-status)] font-bold tracking-[0.08em] uppercase">
        {cfg.label}
      </span>
      {showClock && (
        <>
          <span className="mx-[9px] h-[1em] border-l border-border" />
          <span ref={clockRef} className="text-[11.5px] font-semibold tabular-nums" />
        </>
      )}
    </div>
  );
}

export default StatusPill;
