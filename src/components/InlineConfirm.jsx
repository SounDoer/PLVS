import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Two-step inline confirmation for a single destructive control.
 *
 * Idle: renders `trigger(arm)` — the call site's own button, which calls `arm`
 * on activation. Armed: renders a check (confirm) / x (cancel) pair in place,
 * reusing the rename check/x idiom. Confirm runs `onConfirm` and returns to idle;
 * Escape, the x, or unmount cancels with no effect.
 *
 * @param {(arm: () => void) => React.ReactNode} props.trigger
 * @param {() => void} props.onConfirm
 * @param {string} props.confirmLabel  aria-label for the confirm button
 * @param {string} props.cancelLabel   aria-label for the cancel button
 */
export function InlineConfirm({ trigger, onConfirm, confirmLabel, cancelLabel, className }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const onKey = (e) => {
      if (e.key === "Escape") setArmed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  if (!armed) return trigger(() => setArmed(true));

  return (
    <span className={cn("flex items-center gap-0.5", className)}>
      <button
        type="button"
        aria-label={confirmLabel}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        className="rounded p-0.5 text-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Check className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={cancelLabel}
        onClick={() => setArmed(false)}
        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}
