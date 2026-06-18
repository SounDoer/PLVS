import { LayoutGrid } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { MODULE_REGISTRY } from "./registry.jsx";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Visibility Popover - toggle module visibility from the header
// ---------------------------------------------------------------------------

export function VisibilityPopoverContent() {
  const { state, toggleModuleVisible, setFocus, setHoveredModuleId } = useWorkspaceStore();
  const { visibleModules } = state;
  return (
    <>
      {Object.values(MODULE_REGISTRY).map(({ id, title, Icon }) => {
        const isVisible = visibleModules.includes(id);
        return (
          <button
            key={id}
            type="button"
            className={cn(
              "flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors hover:bg-muted/50",
              isVisible ? "text-foreground" : "text-muted-foreground"
            )}
            onMouseEnter={() => setHoveredModuleId(id)}
            onMouseLeave={() => setHoveredModuleId(null)}
            onClick={() => {
              toggleModuleVisible(id);
              if (!isVisible) setFocus(id);
            }}
          >
            <span
              className={cn(
                "flex shrink-0",
                isVisible ? "text-foreground" : "text-muted-foreground/40"
              )}
            >
              <Icon />
            </span>
            <span className="flex-1 text-left">{title}</span>
            <span
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full",
                isVisible ? "bg-primary" : "bg-muted-foreground/25"
              )}
            />
          </button>
        );
      })}
    </>
  );
}

export function VisibilityPopover() {
  const { setHoveredModuleId } = useWorkspaceStore();
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) setHoveredModuleId(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Module visibility"
          className="flex h-7 w-7 items-center justify-center rounded border border-border/60 bg-card/40 text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        >
          <LayoutGrid size={14} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1">
        <p className="px-2 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
          Modules
        </p>
        <VisibilityPopoverContent />
      </PopoverContent>
    </Popover>
  );
}
