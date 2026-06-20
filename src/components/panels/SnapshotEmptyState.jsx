import { cn } from "@/lib/utils";

/**
 * Empty state shown when a panel's request key has no history at the selected snapshot time
 * (the request did not exist yet), or when the request is over the active analysis cap.
 */
export function SnapshotEmptyState({ message, className }) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 items-center justify-center px-4 text-center text-[length:var(--ui-fs-axis)] text-muted-foreground",
        className
      )}
    >
      {message}
    </div>
  );
}

export const SNAPSHOT_NO_DATA_MESSAGE = "No data for this view at selected time";
export const ANALYSIS_OVER_CAP_MESSAGE = "Too many active analysis views";
