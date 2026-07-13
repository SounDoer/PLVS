import { useRef } from "react";
import { Check } from "lucide-react";
import { DOCK_MODULE_IDS } from "../dockLayout.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import { STATS_CANONICAL_ORDER, STATS_META } from "../../lib/statsCatalog.js";
import { cn } from "@/lib/utils";

/**
 * In-strip horizontal module editor (chips row). Popovers cannot render
 * outside the 72px dock window, so all editing stays inside the strip.
 * Chips list every registry module in catalog order; enabled chips are
 * draggable to reorder (indices are positions in the enabled `modules` list).
 * When the "stats" module is enabled, a second row lets the user pick which
 * catalog readouts DockStats shows.
 */
export function DockModulesEditor({
  modules,
  statsIds = [],
  onToggle,
  onToggleStat,
  onReorder,
  onDone,
}) {
  const dragFromRef = useRef(null);
  const statsEnabled = modules.includes("stats");

  const moduleRow = (
    <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        Modules
      </span>
      {DOCK_MODULE_IDS.map((id) => {
        const enabled = modules.includes(id);
        const enabledIndex = modules.indexOf(id);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={enabled}
            draggable={enabled}
            onDragStart={() => {
              dragFromRef.current = enabledIndex;
            }}
            onDragEnd={() => {
              dragFromRef.current = null;
            }}
            onDragOver={(e) => {
              if (enabled && dragFromRef.current !== null) e.preventDefault();
            }}
            onDrop={() => {
              if (enabled && dragFromRef.current !== null) {
                onReorder(dragFromRef.current, enabledIndex);
              }
              dragFromRef.current = null;
            }}
            onClick={() => onToggle(id)}
            className={cn(
              "flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[10px] font-medium transition-colors",
              enabled
                ? "border-primary/50 bg-primary/15 text-foreground"
                : "border-border/60 text-muted-foreground hover:bg-muted/40"
            )}
          >
            {DOCK_MODULE_REGISTRY[id].label}
            {enabled ? <Check className="size-2.5" /> : null}
          </button>
        );
      })}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onDone}
        className="h-6 shrink-0 rounded-full bg-secondary px-2.5 text-[10px] font-semibold text-secondary-foreground hover:brightness-110"
      >
        Done
      </button>
    </div>
  );

  return (
    <div
      className={cn(
        "h-full min-w-0 px-2",
        statsEnabled ? "flex flex-col justify-center gap-1" : "flex items-center"
      )}
    >
      {statsEnabled ? (
        <>
          {moduleRow}
          <div
            data-testid="dock-stats-picker"
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
          >
            <span className="shrink-0 text-[8px] font-semibold uppercase tracking-wide text-muted-foreground">
              Stats
            </span>
            {STATS_CANONICAL_ORDER.map((id) => {
              const picked = statsIds.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={picked}
                  aria-label={STATS_META[id].shortLabel}
                  onClick={() => onToggleStat(id)}
                  className={cn(
                    "h-5 shrink-0 rounded-full border px-1.5 text-[9px] font-medium transition-colors",
                    picked
                      ? "border-primary/50 bg-primary/15 text-foreground"
                      : "border-border/60 text-muted-foreground hover:bg-muted/40"
                  )}
                >
                  {STATS_META[id].shortLabel}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        moduleRow
      )}
    </div>
  );
}
