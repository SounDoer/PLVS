import { DOCK_MODULE_REGISTRY } from "./registry.jsx";
import { dockModuleIdForPanelModuleId } from "./dockLayout.js";
import { cn } from "@/lib/utils";
import { DockHeightResizeHandle } from "./DockHeightResizeHandle.jsx";
import { DockPanelResizeHandle } from "./DockPanelResizeHandle.jsx";

/** The resizable meter strip. Accessory chrome lives in sibling windows. */
export function DockStrip({
  panels = [],
  controls,
  hoveredPanelId = null,
  edge = "bottom",
  height = 72,
  heightResizeDisabled = false,
  onHeightChange,
  panelSizesById = {},
  panelResizeDisabled = false,
  onPanelResize,
  onPanelResizeReset,
  onPointerEnter,
  onPointerLeave,
}) {
  return (
    <div
      data-testid="dock-strip"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="dock-strip relative h-screen w-screen select-none overflow-hidden text-foreground"
      style={{
        // Spec: dock shares the Views Opacity value. App.jsx keeps setting
        // --panel-opacity in both forms; the window itself is transparent.
        background: "color-mix(in srgb, var(--background) var(--panel-opacity, 100%), transparent)",
      }}
    >
      <DockHeightResizeHandle
        edge={edge}
        height={height}
        disabled={heightResizeDisabled}
        onHeightChange={onHeightChange}
      />
      <div className="flex h-full min-w-0 items-stretch divide-x divide-border/40">
        {panels.map((panel, index) => {
          const dockModuleId = dockModuleIdForPanelModuleId(panel.moduleId) ?? panel.moduleId;
          const entry = DOCK_MODULE_REGISTRY[dockModuleId];
          if (!entry) return null;
          const { Component } = entry;
          const basis = panelSizesById[panel.id] ?? entry.defaultWidth;
          const nextPanel = panels[index + 1];
          const nextDockModuleId = nextPanel
            ? (dockModuleIdForPanelModuleId(nextPanel.moduleId) ?? nextPanel.moduleId)
            : null;
          const nextEntry = nextDockModuleId ? DOCK_MODULE_REGISTRY[nextDockModuleId] : null;
          return (
            <div
              key={panel.id}
              data-testid="dock-module"
              data-panel-id={panel.id}
              data-hover-highlighted={hoveredPanelId === panel.id ? "true" : undefined}
              className={cn(
                "relative transition-[box-shadow] duration-150",
                hoveredPanelId === panel.id && "relative z-10 ring-2 ring-inset ring-primary/60"
              )}
              style={{
                minWidth: entry.minWidth,
                flex: `${entry.flexible ? 1 : 0} 1 ${basis}px`,
              }}
            >
              <Component
                controls={{
                  ...controls,
                  ...controls.controlsByPanelId?.[panel.id],
                }}
              />
              {nextPanel && nextEntry ? (
                <DockPanelResizeHandle
                  leftPanel={panel}
                  rightPanel={nextPanel}
                  leftBasis={basis}
                  rightBasis={panelSizesById[nextPanel.id] ?? nextEntry.defaultWidth}
                  disabled={panelResizeDisabled}
                  onResize={onPanelResize}
                  onReset={onPanelResizeReset}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
