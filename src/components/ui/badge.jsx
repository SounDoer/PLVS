import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-[length:var(--ui-fs-status)] font-semibold uppercase tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-[color:var(--ui-primary-hover)]",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-[color:var(--ui-secondary-hover)]",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-[color:var(--ui-destructive-hover)]",
        outline: "text-foreground",
        success: "border-border bg-secondary text-[color:var(--ui-feedback-success)]",
        warning: "border-border bg-secondary text-[color:var(--ui-feedback-warning)]",
        danger: "border-border bg-secondary text-[color:var(--ui-feedback-danger)]",
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
