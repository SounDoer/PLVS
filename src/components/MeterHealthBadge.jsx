import { meterHealthBadgeModel } from "../meterHealth";

const baseClass =
  "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase";

const toneClass = {
  ok: "bg-emerald-500/15 text-emerald-300",
  warn: "bg-amber-500/15 text-amber-300",
  error: "bg-red-500/15 text-red-300",
};

/**
 * @param {{ health?: string, onToggle?: (() => void) | undefined }} props
 */
export function MeterHealthBadge({ health = "ok", onToggle }) {
  const m = meterHealthBadgeModel(health);
  const cls = `${baseClass} ${toneClass[m.tone] || toneClass.ok}`;
  return (
    <button
      type="button"
      className={cls}
      onClick={onToggle}
      aria-label={m.label}
      title={m.label}
    >
      {m.label}
    </button>
  );
}

