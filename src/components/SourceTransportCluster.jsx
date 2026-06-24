import { useEffect, useRef, useState } from "react";
import { ChevronDown, Play, Radio, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const CHROME = {
  ready: {
    shell: "border border-border/70 bg-secondary text-muted-foreground",
    action: "bg-primary text-primary-foreground hover:brightness-[1.08]",
    Icon: Play,
  },
  live: {
    shell:
      "bg-[color:color-mix(in_srgb,var(--ui-signal-bad)_8%,transparent)] text-[color:var(--ui-signal-bad)] border border-[color:color-mix(in_srgb,var(--ui-signal-bad)_30%,transparent)]",
    action:
      "bg-transparent text-[color:var(--ui-signal-bad)] border border-[color:color-mix(in_srgb,var(--ui-signal-bad)_40%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--ui-signal-bad)_8%,transparent)]",
    Icon: Square,
  },
  snapshot: {
    shell:
      "bg-[color:color-mix(in_srgb,var(--ui-signal-warn)_8%,transparent)] text-[color:var(--ui-signal-warn)] border border-[color:color-mix(in_srgb,var(--ui-signal-warn)_30%,transparent)]",
    action:
      "bg-transparent text-[color:var(--ui-signal-warn)] border border-[color:color-mix(in_srgb,var(--ui-signal-warn)_40%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--ui-signal-warn)_8%,transparent)]",
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

export function SourceTransportCluster({ state, sourceMode, onSourceModeChange, onPrimaryAction }) {
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
    <div className="relative inline-flex items-center gap-1.5">
      <div
        className={cn(
          "inline-flex h-8 max-w-[340px] items-center overflow-hidden rounded-full transition-all duration-200",
          chrome.shell
        )}
      >
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              aria-label={`Source: ${state.sourceLabel}`}
              className="flex h-full items-center gap-1.5 px-3 text-[length:var(--ui-fs-status)] font-bold uppercase tracking-[0.08em] transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {state.sourceLabel}
              <ChevronDown className="size-3" />
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
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[length:var(--ui-fs-metric-meta)] transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    sourceMode === option.id ? "bg-primary" : "bg-muted-foreground/20"
                  )}
                />
                <span className="min-w-0 font-medium text-foreground">{option.label}</span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <span className="h-[1em] w-px bg-current opacity-30" />
        <span className="min-w-0 truncate px-3 text-[length:var(--ui-fs-status)] font-semibold tabular-nums">
          {state.statusLabel}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onPrimaryAction(state.actionKind)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[length:var(--ui-fs-status)] font-bold tracking-[0.06em] transition-all duration-150",
          chrome.action
        )}
      >
        <ActionIcon className="size-[10px]" />
        {state.actionLabel}
      </button>
    </div>
  );
}
