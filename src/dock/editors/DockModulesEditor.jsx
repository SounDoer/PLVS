import { useRef } from "react";
import { Check } from "lucide-react";
import { DOCK_MODULE_IDS } from "../dockLayout.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import { cn } from "@/lib/utils";

/**
 * In-strip horizontal module editor (chips row). Popovers cannot render
 * outside the 72px dock window, so all editing stays inside the strip.
 * Chips list every registry module in catalog order; enabled chips are
 * draggable to reorder (indices are positions in the enabled `modules` list).
 */
export function DockModulesEditor({ modules, onToggle, onReorder, onDone }) {
  const dragFromRef = useRef(null);

  return (
    <div className="flex h-full min-w-0 items-center gap-1.5 overflow-x-auto px-2">
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
}
