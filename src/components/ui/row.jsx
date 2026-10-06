import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A full-width row that is itself the click target: a menu item, a picker option, a disclosure
 * header. It paints its own neutral hover and is one list row tall.
 */
/** @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<"button"> & React.RefAttributes<HTMLButtonElement>>} */
const MenuRow = React.forwardRef(function MenuRow({ className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex min-h-[var(--ui-row-h)] w-full items-center gap-2 rounded-xs px-2 py-1 text-left text-[length:var(--ui-fs-control)] hover:bg-ui-hover",
        className
      )}
      {...props}
    />
  );
});

/**
 * The main click target of a row that also holds a drag handle or trailing actions. The row's
 * container paints the hover and sets the row height, so this fills the remaining width and the
 * full height, and adds no hover or height of its own.
 */
/** @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<"button"> & React.RefAttributes<HTMLButtonElement>>} */
const RowAction = React.forwardRef(function RowAction({ className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-xs text-left",
        className
      )}
      {...props}
    />
  );
});

export { MenuRow, RowAction };
