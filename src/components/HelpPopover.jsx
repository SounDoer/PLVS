import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CircleHelp } from "lucide-react";

function iconForHint(item) {
  const text = String(item).toLowerCase();
  const baseCls = "h-[1.1em] w-[1.1em] shrink-0 text-muted-foreground";
  const common = {
    viewBox: "0 0 24 24",
    className: baseCls,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.1",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };

  if (text.includes("wheel")) {
    return (
      <svg {...common} data-gesture-icon="wheel">
        <rect x="5.5" y="3" width="13" height="17" rx="5.4" />
        <rect
          x="10.7"
          y="4.3"
          width="2.6"
          height="4.4"
          rx="1.3"
          fill="currentColor"
          stroke="none"
        />
      </svg>
    );
  }

  if (text.includes("hover")) {
    return (
      <svg {...common} data-gesture-icon="hover">
        <path d="M5 4.5L18.5 12L13.2 13.4L10.4 18.5L5 4.5Z" />
        <path d="M13.2 13.4L17.5 17.7" />
      </svg>
    );
  }

  if (text.includes("right")) {
    return (
      <svg {...common} data-gesture-icon="right-mouse">
        <rect x="5.5" y="3" width="13" height="17" rx="5.4" />
        <path
          d="M12 3.2H15.2A3.3 3.3 0 0 1 18.5 6.5V8.6H12V3.2Z"
          fill="currentColor"
          stroke="none"
        />
        <line x1="12" y1="3.2" x2="12" y2="8.6" />
      </svg>
    );
  }

  if (text.includes("left") || text.includes("click") || text.includes("drag")) {
    return (
      <svg {...common} data-gesture-icon="left-mouse">
        <rect x="5.5" y="3" width="13" height="17" rx="5.4" />
        <path d="M12 3.2H8.8A3.3 3.3 0 0 0 5.5 6.5V8.6H12V3.2Z" fill="currentColor" stroke="none" />
        <line x1="12" y1="3.2" x2="12" y2="8.6" />
      </svg>
    );
  }

  if (text.includes("m / st") || text.includes("labels")) {
    return (
      <svg {...common}>
        <path d="M7 12.5V8.8A1.8 1.8 0 0 1 10.6 8.8V12" />
        <path d="M10.6 12V7.9A1.8 1.8 0 0 1 14.2 7.9V12.1" />
        <path d="M14.2 12.1V9.2A1.8 1.8 0 0 1 17.8 9.2V14.2A5.4 5.4 0 0 1 12.4 19.6H11.6A4.6 4.6 0 0 1 7 15V12.5Z" />
      </svg>
    );
  }

  return (
    <svg {...common} data-gesture-icon="mouse">
      <rect x="5.5" y="3" width="13" height="17" rx="5.4" />
      <line x1="12" y1="3.2" x2="12" y2="8.6" />
    </svg>
  );
}

function AxisChip({ children }) {
  return (
    <span className="inline-flex h-[1.45em] min-w-[1.45em] items-center justify-center rounded-[3px] border border-border bg-muted/40 px-1 font-[family-name:var(--ui-font-mono)] text-[0.82em] font-semibold leading-none text-muted-foreground">
      {children}
    </span>
  );
}

function Keycap({ children }) {
  return (
    <span className="inline-flex h-[1.45em] items-center justify-center rounded-[3px] border border-border bg-background px-1.5 font-[family-name:var(--ui-font-mono)] text-[0.78em] font-semibold leading-none text-muted-foreground shadow-sm">
      {children}
    </span>
  );
}

function GestureIcon({ item }) {
  const text = String(item).toLowerCase();
  const axis = text.startsWith("x axis")
    ? "X"
    : text.startsWith("y axis")
      ? "Y"
      : text.startsWith("time axis")
        ? "T"
        : null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {axis ? <AxisChip>{axis}</AxisChip> : null}
      {text.includes("ctrl") ? <Keycap>Ctrl</Keycap> : null}
      {iconForHint(item)}
    </span>
  );
}

function normalizeGroups(items) {
  if (!Array.isArray(items)) return [];
  if (items.every((item) => typeof item === "string")) {
    return [{ title: null, items }];
  }
  return items
    .map((group) => {
      if (typeof group === "string") return { title: null, items: [group] };
      return {
        title: group?.title ?? null,
        items: Array.isArray(group?.items) ? group.items : [],
      };
    })
    .filter((group) => group.items.length > 0);
}

export function HelpPopover({ items }) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);
  const groups = normalizeGroups(items);

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 100);
  };
  const cancelClose = () => clearTimeout(closeTimer.current);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 rounded-full text-muted-foreground opacity-50 hover:bg-transparent hover:text-foreground hover:opacity-100"
          aria-label="Shortcuts and gestures"
          onMouseEnter={() => {
            cancelClose();
            setOpen(true);
          }}
          onMouseLeave={scheduleClose}
        >
          <CircleHelp className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        className={cn(
          "flex w-max max-w-[min(100vw-1rem,24rem)] flex-col gap-1 p-3 text-[length:var(--ui-fs-metric-meta)]"
        )}
      >
        {groups.map((group, groupIndex) => (
          <div key={group.title ?? groupIndex} className="flex flex-col gap-1">
            {group.title ? (
              <div
                className={cn(
                  groupIndex > 0 && "mt-1.5",
                  "text-[0.78em] font-semibold text-muted-foreground/70"
                )}
              >
                {group.title}
              </div>
            ) : null}
            {group.items.map((item) => (
              <div
                key={item}
                className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground"
              >
                <GestureIcon item={item} />
                <span>{item}</span>
              </div>
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
