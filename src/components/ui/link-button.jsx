import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A text action that reads as a link: no box, no padding, Secondary text that turns Primary on
 * hover. Font size, underline and an accent colour belong to the caller's context.
 */
/** @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<"button"> & React.RefAttributes<HTMLButtonElement>>} */
const LinkButton = React.forwardRef(function LinkButton({ className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn("text-muted-foreground hover:text-foreground", className)}
      {...props}
    />
  );
});

export { LinkButton };
