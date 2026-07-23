import { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Two-step inline confirmation for a single destructive control.
 *
 * Idle: renders `trigger(arm)` — the call site's own button, which calls `arm`
 * on activation. Armed: renders an x (cancel) / check (confirm) pair in place,
 * reusing the rename x/check idiom. Confirm runs `onConfirm` and returns to idle;
 * Escape, the x, or unmount cancels with no effect.
 *
 * @param {(arm: () => void) => React.ReactNode} props.trigger
 * @param {() => void} props.onConfirm
 * @param {string} props.confirmLabel  aria-label for the confirm button
 * @param {string} props.cancelLabel   aria-label for the cancel button
 */
export function InlineConfirm({ trigger, onConfirm, confirmLabel, cancelLabel, className }) {
  const [armed, setArmed] = useState(false);
  const focusTargetRef = useRef(null);
  const focusPathRef = useRef(null);
  const restoreFocusRef = useRef(false);

  useEffect(() => {
    if (!armed) {
      if (restoreFocusRef.current) {
        restoreFocusRef.current = false;
        let focusTarget = focusTargetRef.current;
        if (focusTarget && !focusTarget.isConnected && focusPathRef.current) {
          focusTarget = focusPathRef.current.reduce(
            (parent, index) => parent?.children[index],
            document.documentElement
          );
        }
        focusTarget?.focus();
      }
      return;
    }
    const onKey = (e) => {
      if (e.key === "Escape") {
        restoreFocusRef.current = true;
        setArmed(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  if (!armed) {
    return trigger(() => {
      const activeElement = document.activeElement;
      focusTargetRef.current =
        activeElement instanceof HTMLElement &&
        activeElement !== document.body &&
        activeElement.isConnected
          ? activeElement
          : null;
      focusPathRef.current = focusTargetRef.current
        ? (() => {
            const path = [];
            let element = focusTargetRef.current;
            while (element !== document.documentElement) {
              const parent = element.parentElement;
              if (!parent) return null;
              path.unshift(Array.from(parent.children).indexOf(element));
              element = parent;
            }
            return path;
          })()
        : null;
      restoreFocusRef.current = false;
      setArmed(true);
    });
  }

  return (
    <span className={cn("flex items-center gap-0.5", className)}>
      <button
        type="button"
        aria-label={cancelLabel}
        autoFocus
        onClick={(e) => {
          e.stopPropagation();
          restoreFocusRef.current = true;
          setArmed(false);
        }}
        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <X className="size-[length:var(--ui-icon-management-action)]" />
      </button>
      <button
        type="button"
        aria-label={confirmLabel}
        onClick={(e) => {
          e.stopPropagation();
          restoreFocusRef.current = false;
          focusTargetRef.current = null;
          focusPathRef.current = null;
          setArmed(false);
          onConfirm();
        }}
        className="rounded p-0.5 text-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Check className="size-[length:var(--ui-icon-management-action)]" />
      </button>
    </span>
  );
}
