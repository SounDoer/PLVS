import { useEffect, useRef } from "react";
import { usePreviewPin } from "../hooks/usePreviewPin.js";
import { useDropdownNavigation } from "../uiNavigation/useDropdownNavigation.js";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.jsx";
import { Button } from "./ui/button.jsx";
import { COMPACT_HOVER_PADDING_CLASS } from "./ui/surfaceStyles.js";
import { cn } from "../lib/utils.js";

/**
 * @param {{
 *   label: string,
 *   target: string,
 *   trigger: import("react").ReactNode,
 *   children: import("react").ReactNode | ((close: () => void) => import("react").ReactNode),
 *   className?: string,
 *   align?: "start" | "center" | "end",
 * }} props
 */
export function FileDetailPopover({ label, target, trigger, children, className, align = "end" }) {
  const content = useRef(null);
  const { mode, modeRef, returnFocusRef, cancelClose, changeMode, scheduleClose, onEscape } =
    usePreviewPin();
  const navigation = useDropdownNavigation(target, {
    open: mode !== "closed",
    onOpenChange: (open) => changeMode(open ? "pinned" : "closed"),
  });
  useEffect(() => {
    if (mode === "pinned") content.current?.focus({ preventScroll: true });
  }, [mode]);
  return (
    <Popover {...navigation.rootProps}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          {...navigation.triggerProps}
          aria-label={label}
          aria-pressed={mode === "pinned"}
          className={cn(
            "h-auto rounded-xs p-0 text-[length:inherit] font-normal text-inherit",
            mode === "pinned" && "bg-ui-hover",
            className
          )}
          onMouseEnter={() => {
            cancelClose();
            if (modeRef.current === "closed") changeMode("preview");
          }}
          onMouseLeave={scheduleClose}
          onKeyDown={onEscape}
          onClick={(event) => {
            event.preventDefault();
            changeMode(modeRef.current === "pinned" ? "closed" : "pinned");
          }}
        >
          {trigger}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        aria-label={label}
        align={align}
        className={cn(
          "max-h-[var(--radix-popover-content-available-height)] w-max max-w-[min(var(--ui-surface-compact-w),calc(100vw-1rem))] select-text overflow-auto overscroll-contain p-0 text-[length:var(--ui-fs-control)]",
          COMPACT_HOVER_PADDING_CLASS
        )}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onKeyDown={onEscape}
        onWheel={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef.current) event.preventDefault();
        }}
      >
        {typeof children === "function" ? children(() => changeMode("closed")) : children}
      </PopoverContent>
    </Popover>
  );
}
