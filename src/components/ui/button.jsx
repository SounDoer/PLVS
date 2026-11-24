import * as React from "react";
import { clsx } from "clsx";

import { cn } from "@/lib/utils";

const BUTTON_CLASS =
  "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-md text-[length:var(--ui-fs-control)] font-medium disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-[1.15em] shrink-0 [&_svg]:shrink-0 outline-none aria-invalid:border-destructive";

const BUTTON_VARIANTS = {
  default:
    "bg-primary text-primary-foreground hover:bg-[color:var(--ui-primary-hover)] focus-visible:bg-[color:var(--ui-primary-hover)] active:bg-[color:var(--ui-primary-hover)]",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-[color:var(--ui-destructive-hover)] focus-visible:bg-[color:var(--ui-destructive-hover)] active:bg-[color:var(--ui-destructive-hover)]",
  outline: "border border-border bg-background hover:bg-ui-hover",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-[color:var(--ui-secondary-hover)] focus-visible:bg-[color:var(--ui-secondary-hover)] active:bg-[color:var(--ui-secondary-hover)]",
  ghost: "hover:bg-ui-hover",
  quiet:
    "bg-transparent text-muted-foreground hover:bg-ui-hover hover:text-foreground focus-visible:bg-ui-hover focus-visible:text-foreground data-[state=open]:bg-ui-hover data-[state=open]:text-foreground",
  link: "text-primary underline-offset-4 hover:underline",
};

// Match the height of form controls; icon buttons use the square counterpart.
const BUTTON_SIZES = {
  default: "h-[var(--ui-control-h)] px-2",
  icon: "size-[var(--ui-control-h)]",
};

/** @param {{variant?: keyof typeof BUTTON_VARIANTS | null, size?: keyof typeof BUTTON_SIZES | null, className?: string}} [options] */
function buttonVariants({ variant = "default", size = "default", className } = {}) {
  return clsx(
    BUTTON_CLASS,
    variant && BUTTON_VARIANTS[variant],
    size && BUTTON_SIZES[size],
    className
  );
}

/** @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<"button"> & { variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "quiet" | "link", size?: "default" | "icon" } & React.RefAttributes<HTMLButtonElement>>} */
const Button = React.forwardRef(function Button(
  { className, variant, size, type = "button", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      data-slot="button"
      type={type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
});

export { Button, buttonVariants };
