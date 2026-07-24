import * as React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/// The one "add a new X" affordance: a dashed-outline slot with a plus and a label, reading as an
/// empty place waiting to be filled. Every add/new entry point routes through this so they share a
/// look instead of each re-deciding variant, font and icon size (see the pre-unification sprawl in
/// the commit that introduced it).
///
/// Full width by default; pass `className` to fit a narrower slot. Forwards its ref and spreads the
/// rest of its props, so it works as a Radix `PopoverTrigger asChild` and accepts `aria-expanded`,
/// `disabled`, `onClick` and the like unchanged.
const ADD_BUTTON_CLASS =
  "flex h-7 w-full items-center justify-center gap-1 rounded-md border border-dashed border-border px-2 text-[length:var(--ui-fs-control)] text-muted-foreground transition-colors hover:border-muted-foreground/40 hover:bg-secondary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40";

export const AddButton = React.forwardRef(function AddButton(
  { label, className, "aria-label": ariaLabel, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel ?? label}
      className={cn(ADD_BUTTON_CLASS, className)}
      {...props}
    >
      {/* A button-leading icon (paired with text) sizes in `em`, per design-tokens.md; the
          management-action token is for icon-only actions. */}
      <Plus className="size-[1.15em]" />
      {label}
    </button>
  );
});
