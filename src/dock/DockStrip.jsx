import { DOCK_MODULE_REGISTRY } from "./registry.jsx";
import { dockModuleIdForPanelModuleId } from "./dockLayout.js";
import { cn } from "@/lib/utils";

function healthFromNotice(notice) {
  if (!notice) return "ok";
  return notice.kind === "error" ? "error" : "warn";
}

/** The reserved 72px meter strip. Accessory chrome lives in sibling windows. */
export function DockStrip({
  panels = [],
  controls,
  hoveredPanelId = null,
  onPointerEnter,
  onPointerLeave,
}) {
  const health = healthFromNotice(controls.notice);

  return (
    <div
      data-testid="dock-strip"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="relative h-screen w-screen select-none overflow-hidden text-foreground"
      style={{
        // Spec: dock shares the Views Opacity value. App.jsx keeps setting
        // --panel-opacity in both forms; the window itself is transparent.
        background: "color-mix(in srgb, var(--background) var(--panel-opacity, 100%), transparent)",
      }}
    >
      <div className="flex h-full min-w-0 items-stretch divide-x divide-border/40">
        {panels.map((panel) => {
          const dockModuleId = dockModuleIdForPanelModuleId(panel.moduleId) ?? panel.moduleId;
          const entry = DOCK_MODULE_REGISTRY[dockModuleId];
          if (!entry) return null;
          const { Component } = entry;
          return (
            <div
              key={panel.id}
              data-testid="dock-module"
              data-panel-id={panel.id}
              data-hover-highlighted={hoveredPanelId === panel.id ? "true" : undefined}
              className={cn(
                "min-w-0 transition-[box-shadow] duration-150",
                entry.flexible ? "flex-1" : "shrink-0",
                hoveredPanelId === panel.id && "relative z-10 ring-2 ring-inset ring-primary/60"
              )}
            >
              <Component
                controls={{
                  ...controls,
                  ...controls.controlsByPanelId?.[panel.id],
                }}
              />
            </div>
          );
        })}
      </div>

      <div
        data-testid="dock-health-dot"
        data-health={health}
        aria-hidden="true"
        className="absolute bottom-1 right-1 z-30 size-1.5 rounded-full"
        style={{
          background:
            health === "error"
              ? "var(--ui-signal-bad)"
              : health === "warn"
                ? "var(--ui-signal-warn)"
                : "color-mix(in srgb, var(--ui-signal-good) 35%, transparent)",
        }}
      />
    </div>
  );
}
