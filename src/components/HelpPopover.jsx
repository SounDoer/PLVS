import { Fragment, useEffect, useRef, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PANEL_HEADER_ACTION_BUTTON } from "@/lib/shellLayout";
import { cn } from "@/lib/utils";
import { CircleHelp } from "lucide-react";
import { IconAction } from "@/components/ui/icon-action";
import { UI_PREFERENCES } from "@/uiPreferences.js";
import { helpPopoverPlacement } from "./helpPopoverPosition.js";

const GESTURE_LABELS = {
  hover: "Hover",
  "left-click": "Left Click",
  "left-drag": "Left Drag",
  "left-hold": "Left Hold",
  "left-double-click": "Left Double-Click",
  "right-drag": "Right Drag",
  "right-double-click": "Right Double-Click",
  wheel: "Wheel",
  "trackpad-swipe": "Horizontal Swipe",
};

function GestureIcon({ gesture }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "size-[length:var(--ui-icon-panel-module)] shrink-0 text-muted-foreground",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: /** @type {const} */ ("round"),
    strokeLinejoin: /** @type {const} */ ("round"),
    "aria-hidden": /** @type {const} */ (true),
    "data-gesture-icon": gesture,
  };
  if (gesture === "hover") {
    return (
      <svg {...common}>
        <path d="M5 4.5L18.5 12L13.2 13.4L10.4 18.5L5 4.5Z" />
        <path d="M13.2 13.4L17.5 17.7" />
      </svg>
    );
  }
  if (gesture === "trackpad-swipe") {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M6 12h12M9 9l-3 3 3 3M15 9l3 3-3 3" />
      </svg>
    );
  }
  const right = gesture === "right-drag" || gesture === "right-double-click";
  return (
    <svg {...common}>
      <rect x="5.5" y="3" width="13" height="17" rx="5.4" />
      {gesture === "wheel" ? (
        <rect
          x="10.7"
          y="4.3"
          width="2.6"
          height="4.4"
          rx="1.3"
          fill="currentColor"
          stroke="none"
        />
      ) : (
        <>
          <path
            d={
              right
                ? "M12 3.2H15.2A3.3 3.3 0 0 1 18.5 6.5V8.6H12Z"
                : "M12 3.2H8.8A3.3 3.3 0 0 0 5.5 6.5V8.6H12Z"
            }
            fill="currentColor"
            stroke="none"
          />
          <path d="M12 3.2v5.4" />
        </>
      )}
    </svg>
  );
}

function Operation({ item }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-[var(--ui-shell-gap)] text-muted-foreground">
      {item.modifiers.map((modifier) => (
        <Fragment key={modifier}>
          <kbd className="rounded-xs border border-border bg-background px-[var(--ui-shell-pad)] font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-metric-meta)]">
            {modifier}
          </kbd>
          <span className="text-muted-foreground">+</span>
        </Fragment>
      ))}
      <span className="inline-flex min-w-0 items-center gap-[var(--ui-shell-gap)]">
        <GestureIcon gesture={item.gesture} />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {item.target ? `${item.target} · ` : ""}
          {GESTURE_LABELS[item.gesture]}
        </span>
      </span>
    </span>
  );
}

function PanelHelp({ items }) {
  const [mode, setMode] = useState("closed");
  const modeRef = useRef("closed");
  const closeTimer = useRef(null);
  const triggerRef = useRef(null);
  const contentRef = useRef(null);
  const returnFocusRef = useRef(false);
  // Floating UI observes the real trigger and content. The virtual anchor can move a long
  // reference alongside the header, using window space while keeping pin/unpin reachable.
  const virtualAnchor = useRef({
    contextElement: null,
    getBoundingClientRect: () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return new DOMRect();
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const gap = UI_PREFERENCES.layout.shell.gapRem.base * rem;
      const margin = UI_PREFERENCES.layout.shell.paddingRem.base * rem * 2;
      const height = contentRef.current
        ? contentRef.current.scrollHeight +
          contentRef.current.offsetHeight -
          contentRef.current.clientHeight
        : 0;
      const width = contentRef.current?.offsetWidth ?? rect.width;
      const placement = helpPopoverPlacement(
        rect,
        width,
        height,
        { width: window.innerWidth, height: window.innerHeight },
        margin,
        gap
      );
      const maxHeight = `${placement.maxHeight}px`;
      if (contentRef.current?.style.getPropertyValue("--help-available-height") !== maxHeight) {
        contentRef.current?.style.setProperty("--help-available-height", maxHeight);
      }
      return new DOMRect(placement.left, placement.top, width, 0);
    },
  });

  const cancelClose = () => clearTimeout(closeTimer.current);
  const changeMode = (nextMode) => {
    cancelClose();
    returnFocusRef.current = modeRef.current === "pinned";
    modeRef.current = nextMode;
    setMode(nextMode);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (modeRef.current !== "pinned") {
        modeRef.current = "closed";
        setMode("closed");
      }
    }, 180);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (mode === "pinned") contentRef.current?.focus({ preventScroll: true });
  }, [mode]);

  const onEscape = (event) => {
    if (event.key !== "Escape" || modeRef.current === "closed") return;
    event.preventDefault();
    event.stopPropagation();
    changeMode("closed");
  };

  return (
    <Popover
      open={mode !== "closed"}
      onOpenChange={(open) => {
        if (!open) changeMode("closed");
      }}
    >
      <PopoverTrigger asChild>
        <IconAction
          ref={(node) => {
            triggerRef.current = node;
            virtualAnchor.current.contextElement = node;
          }}
          className={cn(
            PANEL_HEADER_ACTION_BUTTON,
            mode === "pinned" && "bg-ui-hover text-foreground"
          )}
          aria-label="Shortcuts and gestures"
          aria-pressed={mode === "pinned"}
          onMouseEnter={() => {
            cancelClose();
            if (modeRef.current !== "pinned") changeMode("preview");
          }}
          onMouseLeave={scheduleClose}
          onKeyDown={onEscape}
          onClick={(event) => {
            // Radix's default toggle would close a hover preview on the first click.
            event.preventDefault();
            changeMode(modeRef.current === "pinned" ? "closed" : "pinned");
          }}
        >
          <CircleHelp className="size-[length:var(--ui-icon-panel-action)]" aria-hidden />
        </IconAction>
      </PopoverTrigger>
      {/* Register after the trigger so its initial default anchor cannot override this one. */}
      <PopoverAnchor virtualRef={virtualAnchor} />
      <PopoverContent
        ref={contentRef}
        aria-label="Panel gestures"
        side="bottom"
        align="end"
        sideOffset={0}
        updatePositionStrategy="always"
        style={{
          scrollbarGutter: "stable",
          scrollbarWidth: "thin",
          scrollbarColor: "var(--muted-foreground) var(--popover)",
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (modeRef.current === "pinned") contentRef.current?.focus({ preventScroll: true });
        }}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onWheel={(event) => event.stopPropagation()}
        onEscapeKeyDown={(event) => event.stopPropagation()}
        onKeyDown={onEscape}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef.current) event.preventDefault();
        }}
        className="grid w-max max-w-[calc(100vw-4*var(--ui-shell-pad))] max-h-[var(--help-available-height,calc(100dvh-4*var(--ui-shell-pad)))] grid-cols-[minmax(0,max-content)_minmax(0,max-content)] gap-x-[var(--ui-metric-inline-gap)] gap-y-[var(--ui-drawer-gap)] overflow-y-auto overscroll-contain p-[var(--ui-drawer-pad)] text-[length:var(--ui-fs-metric-meta)]"
      >
        {items.map((group) => (
          <section
            key={group.title}
            className="col-span-2 grid grid-cols-subgrid"
            aria-label={group.title}
          >
            <h3 className="col-span-2 mb-[var(--ui-drawer-row-gap)] text-[length:var(--ui-fs-metric-meta)] font-medium text-foreground">
              {group.title}
            </h3>
            <dl className="col-span-2 grid grid-cols-subgrid items-start gap-y-[var(--ui-drawer-row-gap)]">
              {group.items.map((item) => (
                <Fragment key={item.id}>
                  <dt className="min-w-0">
                    <Operation item={item} />
                  </dt>
                  <dd className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                    {item.effect}
                  </dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** @param {{ items: import('./panels/chartHelp.js').PanelHelpGroup[] }} props */
export function HelpPopover({ items }) {
  // Unmount the stateful child when the last applicable gesture disappears, clearing timers and
  // any pin. Reappearing help starts closed rather than resurrecting an obsolete preview.
  return items?.length ? <PanelHelp items={items} /> : null;
}
