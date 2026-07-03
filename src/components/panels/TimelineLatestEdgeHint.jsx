import { cn } from "@/lib/utils";

export function TimelineLatestEdgeHint({ active, className }) {
  if (!active) return null;

  return (
    <div
      data-timeline-latest-edge-hint
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-y-0 right-0 z-20 w-3", className)}
    >
      <div className="absolute inset-y-0 right-0 w-3 bg-gradient-to-l from-background/60 to-transparent" />
      <div className="absolute inset-y-0 right-0 border-r border-dashed border-muted-foreground/45" />
    </div>
  );
}
