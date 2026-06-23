import { useState } from "react";
import { ChevronDown, Play, Radio, Square } from "lucide-react";
import { cn } from "@/lib/utils";

const CHROME = {
  ready: {
    shell: "bg-secondary text-muted-foreground border border-white/10",
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
    label: "Live",
    description: "System playback / input monitoring",
  },
  {
    id: "file",
    label: "File",
    description: "Analyze a local audio or video file",
  },
];

export function SourceTransportCluster({ state, sourceMode, onSourceModeChange, onPrimaryAction }) {
  const [open, setOpen] = useState(false);
  const chrome = CHROME[state.chromeState] ?? CHROME.ready;
  const ActionIcon = chrome.Icon;

  return (
    <div className="relative inline-flex items-center gap-1.5">
      <div
        className={cn(
          "inline-flex h-8 max-w-[340px] items-center overflow-hidden rounded-full transition-all duration-200",
          chrome.shell
        )}
      >
        <button
          type="button"
          aria-label={`Source: ${state.sourceLabel}`}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex h-full items-center gap-1.5 px-3 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {state.sourceLabel}
          <ChevronDown className="size-3" />
        </button>
        <span className="h-[1em] w-px bg-current opacity-30" />
        <span className="min-w-0 truncate px-3 text-[11.5px] font-semibold tabular-nums">
          {state.statusLabel}
        </span>
      </div>

      <button
        type="button"
        onClick={() => onPrimaryAction(state.actionKind)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[11.5px] font-bold tracking-[0.06em] transition-all duration-150",
          chrome.action
        )}
      >
        <ActionIcon className="size-[10px]" />
        {state.actionLabel}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Source"
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-72 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
            Source
          </p>
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
              className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-1 size-1.5 shrink-0 rounded-full",
                  sourceMode === option.id ? "bg-primary" : "bg-muted-foreground/20"
                )}
              />
              <span className="min-w-0">
                <span className="block font-medium text-foreground">{option.label}</span>
                <span className="mt-0.5 block text-muted-foreground/70">{option.description}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
