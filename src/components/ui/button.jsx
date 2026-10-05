import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[length:var(--ui-fs-control)] font-medium disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-[1.15em] shrink-0 [&_svg]:shrink-0 outline-none aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[color:var(--ui-primary-hover)] focus-visible:bg-[color:var(--ui-primary-hover)] active:bg-[color:var(--ui-primary-hover)]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-[color:var(--ui-destructive-hover)] focus-visible:bg-[color:var(--ui-destructive-hover)] active:bg-[color:var(--ui-destructive-hover)]",
        outline: "border border-border bg-background hover:bg-ui-hover",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color:var(--ui-secondary-hover)] focus-visible:bg-[color:var(--ui-secondary-hover)] active:bg-[color:var(--ui-secondary-hover)]",
        ghost: "hover:bg-ui-hover",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // One text size on purpose: 28px tall, the same height as an input and the add control, so
      // a row of mixed controls shares one baseline. `icon` is its square counterpart.
      size: {
        default: "h-7 px-2",
        icon: "size-7",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

const Button = React.forwardRef(function Button(
  { className, variant, size, asChild = false, type, ...props },
  ref
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      data-slot="button"
      type={!asChild && type === undefined ? "button" : type}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
});

export { Button, buttonVariants };
