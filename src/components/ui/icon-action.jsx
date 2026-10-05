import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * An icon-only action that sits inline in a row or header: muted at rest, Primary Text on hover,
 * with no fill of its own. Padding, visibility and disabled treatment belong to the caller, because
 * they depend on the row the action sits in.
 *
 * Shell-level icon buttons that paint a hover fill use `IconButton` instead.
 */
const IconAction = React.forwardRef(function IconAction({ className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "rounded-xs text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
      {...props}
    />
  );
});

export { IconAction };
