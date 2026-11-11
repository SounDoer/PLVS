import { useEffect, useRef } from "react";
import { usePreviewPin } from "../hooks/usePreviewPin.js";
import { useDropdownNavigation } from "../uiNavigation/useDropdownNavigation.js";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.jsx";
import { cn } from "../lib/utils.js";

export function FileDetailPopover({ label, target, trigger, children, className }) {
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
        <button
          type="button"
          {...navigation.triggerProps}
          aria-label={label}
          aria-pressed={mode === "pinned"}
          className={cn("rounded-xs", mode === "pinned" && "bg-ui-hover", className)}
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
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={content}
        aria-label={label}
        align="end"
        className="max-h-[var(--radix-popover-content-available-height)] w-max max-w-[min(var(--ui-surface-compact-w),calc(100vw-1rem))] select-text overflow-auto overscroll-contain p-[var(--ui-drawer-pad)] text-[length:var(--ui-fs-control)]"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onKeyDown={onEscape}
        onWheel={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef.current) event.preventDefault();
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
