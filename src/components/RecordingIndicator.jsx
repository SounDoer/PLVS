import { LAYER_INDICATOR } from "./ui/layers.js";
import { cn } from "@/lib/utils";

/** @param {{ state?: string | null, className?: string }} props */
export function RecordingIndicator({ state, className }) {
  if (!state || state === "completed" || state === "failed") return null;
  return (
    <div
      role="status"
      aria-label="visual recording active"
      title={state === "stopping" ? "Finalizing Recording" : "Recording"}
      className={cn(
        "pointer-events-none fixed right-1 top-1 h-2 w-2 rounded-full bg-[color:var(--ui-activity-live)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--background)_75%,transparent)]",
        LAYER_INDICATOR,
        className
      )}
      data-recording-state={state}
    />
  );
}
