import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { HoverTip } from "./HoverTip.jsx";
import { cn } from "@/lib/utils";

const FEEDBACK_DURATION_MS = 1500;

export function CopyableTextBlock({ value, ariaLabel = "copy text", className }) {
  const [copyState, setCopyState] = useState("idle");
  const resetTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    },
    []
  );

  const scheduleReset = () => {
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      setCopyState("idle");
      resetTimerRef.current = null;
    }, FEEDBACK_DURATION_MS);
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    scheduleReset();
  };

  const tip = copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy Failed" : "Copy";
  const CopyIcon = copyState === "copied" ? Check : copyState === "failed" ? X : Copy;

  return (
    <div
      className={cn(
        "relative rounded-md border border-border/60 bg-muted/25 px-3 py-2.5 pr-10",
        "transition-colors focus-within:border-border",
        className
      )}
    >
      <div
        role="textbox"
        aria-label={`${ariaLabel} text`}
        aria-readonly="true"
        tabIndex={0}
        className="whitespace-pre-wrap break-words font-mono text-[length:var(--ui-fs-axis)] leading-relaxed text-foreground/85 outline-none selection:bg-primary/30"
      >
        {value}
      </div>
      <HoverTip tip={tip} side="top" align="end" className="absolute top-2 right-2">
        <button
          type="button"
          aria-label={ariaLabel}
          data-copy-state={copyState}
          onClick={copyText}
          className={cn(
            "rounded-xs p-1 text-muted-foreground/60 transition-colors",
            "hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:text-foreground",
            copyState === "copied" && "text-primary",
            copyState === "failed" && "text-destructive"
          )}
        >
          <CopyIcon className="size-[length:var(--ui-icon-management-action)]" aria-hidden />
        </button>
      </HoverTip>
    </div>
  );
}
