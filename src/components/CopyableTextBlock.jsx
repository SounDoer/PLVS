import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { HoverTip } from "./HoverTip.jsx";
import { cn } from "@/lib/utils";
import { IconAction } from "@/components/ui/icon-action";

const FEEDBACK_DURATION_MS = 1500;

/** @param {{ value: any, ariaLabel?: any, className?: any }} props */
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
        "relative rounded-md border border-border bg-muted px-3 py-2 pr-10",
        "focus-within:border-border",
        className
      )}
    >
      <div
        role="textbox"
        aria-label={`${ariaLabel} text`}
        aria-readonly="true"
        tabIndex={0}
        className="whitespace-pre-wrap break-words font-mono text-[length:var(--ui-fs-axis)] leading-relaxed text-foreground outline-none selection:bg-primary/30"
      >
        {value}
      </div>
      <HoverTip tip={tip} side="top" align="end" className="absolute top-2 right-2">
        <IconAction
          aria-label={ariaLabel}
          data-copy-state={copyState}
          onClick={copyText}
          className={cn(
            "p-1",
            "hover:bg-ui-hover focus-visible:bg-ui-hover focus-visible:text-foreground",
            copyState === "copied" &&
              "bg-[color:var(--ui-interface-success)] text-[color:var(--ui-content-on-success)]",
            copyState === "failed" && "text-[color:var(--ui-feedback-danger)]"
          )}
        >
          <CopyIcon className="size-[length:var(--ui-icon-management-action)]" aria-hidden />
        </IconAction>
      </HoverTip>
    </div>
  );
}
