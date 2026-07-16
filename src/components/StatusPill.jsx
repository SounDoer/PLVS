import { cn } from "@/lib/utils";

const STATE_CONFIG = {
  ready: {
    bg: "bg-secondary",
    border: "border border-white/10",
    color: "text-muted-foreground",
    label: "READY",
    showClock: (clock) => clock != null,
    dotPulse: false,
    dotGlow: "",
  },
  live: {
    bg: "bg-[color:color-mix(in_srgb,var(--ui-signal-bad)_8%,transparent)]",
    border: "border border-[color:color-mix(in_srgb,var(--ui-signal-bad)_30%,transparent)]",
    color: "text-[color:var(--ui-signal-bad)]",
    label: "LIVE",
    showClock: () => true,
    dotPulse: true,
    dotGlow:
      "shadow-[0_0_0_3px_color-mix(in_srgb,var(--ui-signal-bad)_18%,transparent),0_0_6px_var(--ui-signal-bad)]",
  },
  snapshot: {
    bg: "bg-[color:color-mix(in_srgb,var(--ui-signal-warn)_8%,transparent)]",
    border: "border border-[color:color-mix(in_srgb,var(--ui-signal-warn)_30%,transparent)]",
    color: "text-[color:var(--ui-signal-warn)]",
    label: "SNAP",
    showClock: (clock) => clock != null,
    dotPulse: false,
    dotGlow: "",
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
          cfg.dotPulse && "status-dot-pulse",
          cfg.dotGlow
        )}
      />
      <span className="ml-1.5 text-[length:var(--ui-fs-status)] font-bold tracking-[0.08em] uppercase">
        {cfg.label}
      </span>
      {showClock && (
        <>
          <span className="w-px h-[1em] bg-current opacity-30 mx-[9px]" />
          <span ref={clockRef} className="text-[11.5px] font-semibold tabular-nums" />
        </>
      )}
    </div>
  );
}

export default StatusPill;
