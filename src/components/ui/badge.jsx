import { clsx } from "clsx";

import { cn } from "@/lib/utils";

const BADGE_CLASS =
  "inline-flex items-center rounded-md border px-2 py-0 text-[length:var(--ui-fs-status)] font-semibold uppercase tracking-wide";

const BADGE_VARIANTS = {
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
};

/** @param {{variant?: keyof typeof BADGE_VARIANTS | null}} [options] */
function badgeVariants({ variant = "default" } = {}) {
  return clsx(BADGE_CLASS, variant && BADGE_VARIANTS[variant]);
}

function Badge({ className, variant, ...props }) {
  return <div data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
