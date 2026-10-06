import { cn } from "@/lib/utils";

const LATEST_EDGE_FADE_CLASS = "from-background/60";
const LATEST_EDGE_LINE_CLASS = "border-muted-foreground/60";

/** @param {{ active: any, className?: string }} props */
export function TimelineLatestEdgeHint({ active, className }) {
  if (!active) return null;

  return (
    <div
      data-timeline-latest-edge-hint
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-y-0 right-0 z-20 w-3", className)}
    >
      <div
        className={cn(
          "absolute inset-y-0 right-0 w-3 bg-gradient-to-l to-transparent",
          LATEST_EDGE_FADE_CLASS
        )}
      />
      <div
        className={cn("absolute inset-y-0 right-0 border-r border-dashed", LATEST_EDGE_LINE_CLASS)}
      />
    </div>
  );
}
