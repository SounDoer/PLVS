import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[length:var(--ui-fs-status)] font-semibold uppercase tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
        success:
          "border-transparent bg-[color:color-mix(in_srgb,var(--ui-interface-success)_15%,transparent)] text-[color:var(--ui-feedback-success)]",
        warning:
          "border-transparent bg-[color:color-mix(in_srgb,var(--ui-interface-warning)_15%,transparent)] text-[color:var(--ui-feedback-warning)]",
        danger:
          "border-transparent bg-[color:color-mix(in_srgb,var(--ui-interface-danger)_15%,transparent)] text-[color:var(--ui-feedback-danger)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({ className, variant, ...props }) {
  return <div data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
