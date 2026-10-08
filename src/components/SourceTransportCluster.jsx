import { useEffect, useRef, useState } from "react";
import { ChevronDown, Play, Radio, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const CHROME = {
  ready: {
    shell: "border border-border bg-secondary text-muted-foreground",
    action:
      "bg-primary text-primary-foreground hover:bg-[color:var(--ui-primary-hover)] focus-visible:bg-[color:var(--ui-primary-hover)] active:bg-[color:var(--ui-primary-hover)]",
    Icon: Play,
  },
  live: {
    shell:
      "border border-[color:var(--ui-live-border)] bg-[color:var(--ui-live-surface)] text-[color:var(--ui-activity-live)]",
    action:
      "bg-[color:var(--ui-live-active)] text-[color:var(--ui-activity-live)] hover:bg-[color:var(--ui-live-hover)] focus-visible:bg-[color:var(--ui-live-hover)] active:bg-[color:var(--ui-live-hover)]",
    Icon: Square,
  },
  snapshot: {
    shell:
      "border border-[color:var(--ui-snapshot-border)] bg-[color:var(--ui-snapshot-surface)] text-[color:var(--ui-activity-snapshot)]",
    action:
      "bg-[color:var(--ui-snapshot-active)] text-[color:var(--ui-activity-snapshot)] hover:bg-[color:var(--ui-snapshot-hover)] focus-visible:bg-[color:var(--ui-snapshot-hover)] active:bg-[color:var(--ui-snapshot-hover)]",
    Icon: Radio,
  },
};

const SOURCE_OPTIONS = [
  {
    id: "live",
    label: "LIVE",
  },
  {
    id: "file",
    label: "FILE",
  },
];

const TRANSPORT_WIDTH_CLASS = {
  live: "w-[calc(12em+5rem)]",
  file: "w-[calc(15em+5rem)]",
};

const ACTION_WIDTH_CLASS = {
  live: "w-[calc(4.6em+1.875rem)]",
  file: "w-[calc(7.5em+1.875rem)]",
};

export function SourceTransportCluster({
  state,
  sourceMode,
  sourceLocked = false,
  onSourceModeChange,
  onPrimaryAction,
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef(null);
  const contentRef = useRef(null);
  const chrome = CHROME[state.chromeState] ?? CHROME.ready;
  const ActionIcon = chrome.Icon;

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      const target = event.target;
      if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div
      style={{ fontSize: "var(--ui-fs-status)" }}
      className={cn(
        "relative inline-flex h-[var(--ui-control-h)] max-w-full shrink-0 items-center overflow-hidden rounded-full",
        TRANSPORT_WIDTH_CLASS[sourceMode] ?? TRANSPORT_WIDTH_CLASS.live,
        chrome.shell
      )}
    >
      {sourceLocked ? (
        <span className="flex h-full shrink-0 items-center rounded-full px-3 text-[length:var(--ui-fs-status)] font-bold uppercase tracking-[0.08em]">
          {state.sourceLabel}
        </span>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              aria-label={`Source: ${state.sourceLabel}`}
              className="flex h-full shrink-0 items-center gap-1 rounded-full px-3 text-[length:var(--ui-fs-status)] font-bold uppercase tracking-[0.08em] hover:bg-ui-hover"
            >
              {state.sourceLabel}
              <ChevronDown className="size-[1em]" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            ref={contentRef}
            role="menu"
            aria-label="Source"
            align="start"
            sideOffset={6}
            className="w-auto min-w-[var(--radix-popover-trigger-width)] p-1"
          >
            {SOURCE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={sourceMode === option.id}
                onClick={() => {
                  setOpen(false);
                  if (option.id !== sourceMode) onSourceModeChange(option.id);
                }}
                className="flex w-full items-center gap-2 rounded-xs px-2 py-1 text-left text-[length:var(--ui-fs-metric-meta)] hover:bg-ui-hover"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full border",
                    sourceMode === option.id
                      ? "border-primary bg-primary"
                      : "border-muted-foreground bg-transparent"
                  )}
                />
                <span className="min-w-0 font-medium text-foreground">{option.label}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}
      <span className="min-w-0 flex-1 truncate pl-1.2 pr-1 text-[length:var(--ui-fs-status)] font-semibold tabular-nums">
        {state.statusLabel}
      </span>

      <button
        type="button"
        disabled={state.primaryActionDisabled}
        onClick={() => onPrimaryAction(state.actionKind)}
        className={cn(
          "ml-1 flex h-full shrink-0 items-center justify-center gap-1 rounded-full px-3 font-bold tracking-[0.06em] disabled:cursor-not-allowed disabled:opacity-50",
          ACTION_WIDTH_CLASS[sourceMode] ?? ACTION_WIDTH_CLASS.live,
          chrome.action
        )}
      >
        <ActionIcon className="size-[1em]" />
        {state.actionLabel}
      </button>
    </div>
  );
}
