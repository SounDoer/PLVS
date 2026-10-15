import { cn } from "@/lib/utils";

const LATEST_EDGE_FADE_CLASS = "from-background/60";
const LATEST_EDGE_LINE_CLASS = "border-muted-foreground/60";

/** @param {{ active: boolean, className?: string, edge?: string }} props */
export function TimelineLatestEdgeHint({ active, className, edge = "right" }) {
  if (!active) return null;

  const vertical = edge === "top" || edge === "bottom";
  return (
    <div
      data-timeline-latest-edge-hint
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-20",
        vertical ? "inset-x-0 h-3" : "inset-y-0 w-3",
        className
      )}
      style={{ [edge]: 0 }}
    >
      <div
        className={cn("absolute inset-0", LATEST_EDGE_FADE_CLASS)}
        style={{
          background: `linear-gradient(to ${edge === "right" ? "left" : edge === "left" ? "right" : edge === "top" ? "bottom" : "top"}, color-mix(in srgb, var(--background) 60%, transparent), transparent)`,
        }}
      />
      <div
        className={cn(
          "absolute border-dashed",
          vertical ? "inset-x-0 border-t" : "inset-y-0 border-l",
          LATEST_EDGE_LINE_CLASS
        )}
        style={{ [edge]: 0 }}
      />
    </div>
  );
}
