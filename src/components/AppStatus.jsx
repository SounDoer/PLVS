import { TriangleAlert, CircleAlert, Info, Download, LoaderCircle, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.jsx";
import { HoverTip } from "./HoverTip.jsx";
import { LinkButton } from "./ui/link-button.jsx";
import { cn } from "../lib/utils.js";
import { useCallback, useEffect, useState } from "react";

export function StatusIcon({ item, className = "size-3.5 shrink-0" }) {
  const Icon =
    item?.id === "update"
      ? ({ downloading: LoaderCircle, ready: Check, error: CircleAlert }[item.phase] ?? Download)
      : item?.kind === "error"
        ? CircleAlert
        : item?.kind === "warning"
          ? TriangleAlert
          : Info;
  return (
    <Icon
      aria-hidden="true"
      className={cn(className, item?.phase === "downloading" && "animate-spin")}
    />
  );
}

/** @param {{ items: import("../lib/appStatus.js").AppStatusItem[], onAction?: (action: string) => void, accessory?: boolean, showTitle?: boolean }} props */
export function AppStatusList({ items, onAction = () => {}, accessory = false, showTitle = true }) {
  return (
    <section
      aria-label="status details"
      className={cn(
        "overflow-y-auto p-3 text-[length:var(--ui-fs-control)]",
        accessory ? "max-h-screen w-[22rem] max-w-full" : "max-h-[min(28rem,80vh)]"
      )}
    >
      {showTitle ? <h2 className="mb-2 font-semibold">Status</h2> : null}
      {items.length === 0 ? (
        <p className="text-muted-foreground">No Active Notices</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2" data-status-id={item.id}>
              <StatusIcon item={item} />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "font-medium",
                    item.kind === "error" && "text-[color:var(--ui-feedback-danger)]"
                  )}
                >
                  {item.text}
                </p>
                {item.details !== item.text ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                    {item.details}
                  </p>
                ) : null}
                {item.action ? (
                  <LinkButton
                    type="button"
                    onClick={() => onAction(item.action)}
                    className="mt-1 text-primary hover:underline"
                  >
                    {item.action === "update"
                      ? "View Update Details"
                      : item.action === "check-update"
                        ? "Check Again"
                        : "Open Settings"}
                  </LinkButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** @param {{ items: import("../lib/appStatus.js").AppStatusItem[], onClick?: (event: any) => void, [key: string]: any }} props */
export function AppStatusSummary({ items, onClick, ...props }) {
  const first = items[0];
  if (!first) return null;
  return (
    <HoverTip
      tip={props["aria-expanded"] ? undefined : first.details}
      className="min-w-0 max-w-[min(32rem,38vw)]"
      tipClassName="max-w-[min(28rem,90vw)] whitespace-normal"
    >
      <LinkButton
        type="button"
        aria-label={`status: ${first.text}${items.length > 1 ? `, ${items.length} notices` : ""}`}
        onClick={onClick}
        className={cn(
          "flex min-w-0 max-w-full items-center gap-2 text-[length:var(--ui-fs-status)] font-medium hover:underline",
          first.kind === "error"
            ? "text-[color:var(--ui-feedback-danger)]"
            : first.kind === "warning"
              ? "text-[color:var(--ui-interface-warning)]"
              : "text-primary"
        )}
        {...props}
      >
        <StatusIcon item={first} />
        <span className="truncate">{first.text}</span>
        {items.length > 1 ? <span className="shrink-0">· {items.length}</span> : null}
      </LinkButton>
    </HoverTip>
  );
}

/** @param {{ items: import("../lib/appStatus.js").AppStatusItem[], onAction?: (action: string) => void, onOpenChange?: (open: boolean) => void, requestedOpen?: boolean }} props */
export function AppStatusPopover({ items, onAction, onOpenChange, requestedOpen = false }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(requestedOpen);
  }, [requestedOpen]);
  const changeOpen = useCallback(
    (value) => {
      setOpen(value);
      onOpenChange?.(value);
    },
    [onOpenChange]
  );
  useEffect(() => {
    if (open && items.length === 0) changeOpen(false);
  }, [open, items.length, changeOpen]);
  if (!items.length) return null;
  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <AppStatusSummary items={items} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-1rem)] p-0">
        <AppStatusList
          items={items}
          onAction={(action) => {
            changeOpen(false);
            onAction?.(action);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
