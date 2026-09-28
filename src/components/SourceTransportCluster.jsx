import { useEffect, useRef, useState } from "react";
import { ChevronDown, Play, Radio, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const CHROME = {
  ready: {
    shell: "border border-border bg-secondary text-muted-foreground",
    action: "bg-primary text-primary-foreground hover:bg-[color:var(--ui-primary-hover)]",
    Icon: Play,
  },
  live: {
    shell:
      "border border-[color:color-mix(in_srgb,var(--ui-activity-live)_50%,var(--secondary))] bg-[color:color-mix(in_srgb,var(--ui-activity-live)_10%,var(--secondary))] text-[color:var(--ui-activity-live)]",
    action:
      "bg-[color:color-mix(in_srgb,var(--ui-activity-live)_24%,var(--secondary))] text-[color:var(--ui-activity-live)] hover:bg-[color:color-mix(in_srgb,var(--ui-activity-live)_36%,var(--secondary))]",
    Icon: Square,
  },
  snapshot: {
    shell:
      "border border-[color:color-mix(in_srgb,var(--ui-activity-snapshot)_50%,var(--secondary))] bg-[color:color-mix(in_srgb,var(--ui-activity-snapshot)_10%,var(--secondary))] text-[color:var(--ui-activity-snapshot)]",
    action:
      "bg-[color:color-mix(in_srgb,var(--ui-activity-snapshot)_24%,var(--secondary))] text-[color:var(--ui-activity-snapshot)] hover:bg-[color:color-mix(in_srgb,var(--ui-activity-snapshot)_36%,var(--secondary))]",
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
      className={cn(
        "relative inline-flex h-7 max-w-[340px] items-center overflow-hidden rounded-full p-0.5 transition-all duration-200",
        chrome.shell
      )}
    >
      {sourceLocked ? (
        <span className="flex h-full items-center rounded-full px-2.5 text-[length:var(--ui-fs-status)] font-bold uppercase tracking-[0.08em]">
          {state.sourceLabel}
        </span>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              aria-label={`Source: ${state.sourceLabel}`}
              className="flex h-full items-center gap-1.5 rounded-full px-2.5 text-[length:var(--ui-fs-status)] font-bold uppercase tracking-[0.08em] transition-colors hover:bg-muted/50"
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
                className="flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-[length:var(--ui-fs-metric-meta)] transition-colors hover:bg-muted/50"
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
      <span className="min-w-0 truncate pl-1.2 pr-2.5 text-[length:var(--ui-fs-status)] font-semibold tabular-nums">
        {state.statusLabel}
      </span>

      <button
        type="button"
        disabled={state.primaryActionDisabled}
        onClick={() => onPrimaryAction(state.actionKind)}
        className={cn(
          "ml-1 flex h-full items-center gap-1.5 rounded-full px-3 text-[length:var(--ui-fs-status)] font-bold tracking-[0.06em] transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50",
          chrome.action
        )}
      >
        <ActionIcon className="size-[1em]" />
        {state.actionLabel}
      </button>
    </div>
  );
}
