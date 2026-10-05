import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A full-width row that is itself the click target: a menu item, a picker option, a disclosure
 * header. It paints its own neutral hover.
 */
const MenuRow = React.forwardRef(function MenuRow({ className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex w-full items-center gap-2 rounded-xs px-1.5 py-1.5 text-left text-[length:var(--ui-fs-control)] transition-colors hover:bg-ui-hover",
        className
      )}
      {...props}
    />
  );
});

/**
 * The main click target of a row that also holds a drag handle or trailing actions. The row's
 * container paints the hover, so this fills the remaining width and adds none of its own.
 */
const RowAction = React.forwardRef(function RowAction({ className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-xs text-left", className)}
      {...props}
    />
  );
});

export { MenuRow, RowAction };
