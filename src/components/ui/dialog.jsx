import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { useModalBackdropElement } from "../../hooks/FloatingPanelHostContext.jsx";
import { cn } from "@/lib/utils";
import { LAYER_FLOATING } from "./layers.js";
import { MODAL_SURFACE_CLASS, SCRIM_CLASS } from "./surfaceStyles.js";

const Dialog = DialogPrimitive.Root;

const DIALOG_WIDTH_CLASS = {
  sm: "w-[min(var(--ui-surface-compact-w),calc(100vw-2rem))]",
  md: "w-[min(var(--ui-surface-dialog-w),calc(100vw-2rem))]",
  lg: "w-[min(var(--ui-surface-wide-w),calc(100vw-2rem))]",
  custom: "",
};

function useBackdropContainer(getElement) {
  const [container, setContainer] = React.useState(null);
  React.useLayoutEffect(() => {
    setContainer(getElement?.() ?? null);
  }, [getElement]);
  return container;
}

/**
 * The one modal shell: scrim, stacking layer, placement, surface, radius and padding.
 *
 * `size` picks one of three widths; `custom` leaves the width to `className`. `layer` is a constant
 * from `layers.js` and applies to the scrim and the dialog together. `centered={false}` drops the
 * centring so a dragged dialog can place itself through `style`. `overlayProps` reach the scrim,
 * for dialogs that dismiss on a scrim click. `dimmed={false}` keeps modal input/scroll handling
 * without painting a backdrop or consulting a floating host backdrop container.
 */
/** @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { size?: "sm" | "md" | "lg" | "custom", layer?: string, centered?: boolean, dimmed?: boolean, overlayProps?: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & { [key: `data-${string}`]: string } } & React.RefAttributes<React.ElementRef<typeof DialogPrimitive.Content>>>} */
const DialogContent = React.forwardRef(function DialogContent(
  {
    size = "md",
    layer = LAYER_FLOATING,
    centered = true,
    dimmed = true,
    overlayProps,
    className,
    children,
    ...props
  },
  ref
) {
  const backdropElement = useModalBackdropElement();
  const scopedBackdrop = dimmed ? backdropElement : null;
  const backdropContainer = useBackdropContainer(scopedBackdrop);
  const overlay = (
    <DialogPrimitive.Overlay
      {...overlayProps}
      data-modal-backdrop-scope={!dimmed ? "none" : scopedBackdrop ? "panel" : "viewport"}
      className={cn(
        dimmed ? SCRIM_CLASS : "fixed inset-0",
        layer,
        overlayProps?.className,
        scopedBackdrop && "absolute"
      )}
    />
  );
  return (
    <>
      {(!scopedBackdrop || backdropContainer) && (
        <DialogPrimitive.Portal container={backdropContainer ?? undefined}>
          {overlay}
        </DialogPrimitive.Portal>
      )}
      <DialogPrimitive.Portal>
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
    </>
  );
});

/** @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> & React.RefAttributes<React.ElementRef<typeof DialogPrimitive.Title>>>} */
const DialogTitle = React.forwardRef(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-[length:var(--ui-fs-control)] font-semibold text-foreground", className)}
      {...props}
    />
  );
});

/** @type {React.ForwardRefExoticComponent<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description> & React.RefAttributes<React.ElementRef<typeof DialogPrimitive.Description>>>} */
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
/** @param {React.ComponentPropsWithoutRef<"div"> & { divided?: boolean }} props */
function DialogFooter({ divided = false, className, ...props }) {
  return (
    <div
      className={cn("flex justify-end gap-2", divided && "border-t border-border pt-2", className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle };
