import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import { LAYER_FLOATING } from "./layers.js";
import { MODAL_SURFACE_CLASS, SCRIM_CLASS } from "./surfaceStyles.js";

const Dialog = DialogPrimitive.Root;

const DIALOG_WIDTH_CLASS = {
  sm: "w-[min(20rem,calc(100vw-2rem))]",
  md: "w-[min(28rem,calc(100vw-2rem))]",
  lg: "w-[min(34rem,calc(100vw-2rem))]",
  custom: "",
};

/**
 * The one modal shell: scrim, stacking layer, placement, surface, radius and padding.
 *
 * `size` picks one of three widths; `custom` leaves the width to `className`. `layer` is a constant
 * from `layers.js` and applies to the scrim and the dialog together. `centered={false}` drops the
 * centring so a dragged dialog can place itself through `style`. `overlayProps` reach the scrim,
 * for dialogs that dismiss on a scrim click.
 */
const DialogContent = React.forwardRef(function DialogContent(
  {
    size = "md",
    layer = LAYER_FLOATING,
    centered = true,
    overlayProps,
    className,
    children,
    ...props
  },
  ref
) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        {...overlayProps}
        className={cn(SCRIM_CLASS, layer, overlayProps?.className)}
      />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-xl p-3",
          centered && "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
          DIALOG_WIDTH_CLASS[size],
          MODAL_SURFACE_CLASS,
          layer,
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

const DialogTitle = React.forwardRef(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-[length:var(--ui-fs-control)] font-semibold text-foreground", className)}
      {...props}
    />
  );
});

const DialogDescription = React.forwardRef(function DialogDescription(
  { className, ...props },
  ref
) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("mt-0 text-[length:var(--ui-fs-metric-meta)] text-muted-foreground", className)}
      {...props}
    />
  );
});

/** The action row. `divided` adds the rule that separates it from a scrolling body. */
function DialogFooter({ divided = false, className, ...props }) {
  return (
    <div
      className={cn("flex justify-end gap-2", divided && "border-t border-border pt-2", className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle };
