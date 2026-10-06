import { Check } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/** @type {import("react").ForwardRefExoticComponent<import("react").ComponentPropsWithoutRef<"input"> & import("react").RefAttributes<HTMLInputElement>>} */
export const Checkbox = forwardRef(function Checkbox({ className, ...props }, ref) {
  return (
    <span className="relative inline-flex size-4 shrink-0">
      <input
        {...props}
        ref={ref}
        type="checkbox"
        className={cn(
          "peer size-4 cursor-pointer appearance-none rounded-xs border border-input bg-transparent checked:border-primary checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      />
      <Check
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto size-[length:var(--ui-icon-management-action)] stroke-[3] text-primary-foreground opacity-0 peer-checked:opacity-100 peer-disabled:opacity-50"
      />
    </span>
  );
});
