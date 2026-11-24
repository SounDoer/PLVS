import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { COMPACT_SWITCH_CLASS, COMPACT_SWITCH_THUMB_CLASS } from "./controlStyles.js";

/** @type {import("react").ForwardRefExoticComponent<Omit<import("react").ComponentPropsWithoutRef<"input">, "type" | "onChange"> & { onCheckedChange?: (checked: boolean) => void } & import("react").RefAttributes<HTMLInputElement>>} */
export const Switch = forwardRef(function Switch(
  { className, onCheckedChange, onKeyDown, ...props },
  ref
) {
  return (
    <span className="relative inline-flex shrink-0 items-center has-[:disabled]:opacity-50">
      <input
        {...props}
        ref={ref}
        type="checkbox"
        role="switch"
        data-slot="switch"
        className={cn(
          "peer cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed",
          COMPACT_SWITCH_CLASS,
          className
        )}
        onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          // Preserve Enter activation from the previous button-backed switch.
          if (event.key === "Enter" && !event.defaultPrevented) {
            event.preventDefault();
            event.currentTarget.click();
          }
        }}
      />
      <span
        aria-hidden="true"
        data-slot="switch-thumb"
        className={`pointer-events-none absolute left-px rounded-full transition-transform ${COMPACT_SWITCH_THUMB_CLASS}`}
      />
    </span>
  );
});
