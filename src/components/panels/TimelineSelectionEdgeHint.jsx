import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Points toward the globally selected sample when it is outside this panel's time window. */
export function TimelineSelectionEdgeHint({ direction, className }) {
  if (direction !== "left" && direction !== "right") return null;

  const pointsLeft = direction === "left";
  const Icon = pointsLeft ? ChevronLeft : ChevronRight;

  return (
    <div
      data-testid="timeline-selection-edge-hint"
      data-direction={direction}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-y-0 z-20 w-4 text-[color:var(--ui-loudness-selection)]",
        pointsLeft ? "left-0" : "right-0",
        className
      )}
    >
      <div
        className="absolute inset-0"
        style={{
          background: pointsLeft
            ? "linear-gradient(to right, color-mix(in srgb, currentColor 22%, transparent), transparent)"
            : "linear-gradient(to left, color-mix(in srgb, currentColor 22%, transparent), transparent)",
        }}
      />
      <div
        className={cn(
          "absolute inset-y-0 border-dashed border-current/65",
          pointsLeft ? "left-0 border-l" : "right-0 border-r"
        )}
      />
      <Icon className="absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2" />
    </div>
  );
}
