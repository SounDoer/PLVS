import { meterHealthBadgeModel } from "../meterHealth";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const variantByTone = {
  ok: "success",
  warn: "warning",
  error: "danger",
};

/**
 * @param {{ health?: string, onToggle?: (() => void) | undefined }} props
 */
export function MeterHealthBadge({ health = "ok", onToggle }) {
  const m = meterHealthBadgeModel(health);
  const variant = variantByTone[m.tone] || "success";
  return (
    <button
      type="button"
      className={cn(
        badgeVariants({ variant }),
        "h-auto cursor-pointer border-transparent normal-case"
      )}
      onClick={onToggle}
      aria-label={m.label}
      title={m.label}
    >
      {m.label}
    </button>
  );
}
