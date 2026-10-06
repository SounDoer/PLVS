import { DOCK_MODULE_REGISTRY } from "./registry.jsx";
import { dockModuleIdForPanelModuleId } from "./dockLayout.js";
import { cn } from "@/lib/utils";
import { DockHeightResizeHandle } from "./DockHeightResizeHandle.jsx";
import { DockPanelResizeHandle } from "./DockPanelResizeHandle.jsx";
import { dockHeightMode } from "./dockSizing.js";
import { RecordingIndicator } from "../components/RecordingIndicator.jsx";
import { DOCK_SURFACE_CLASS } from "../components/ui/surfaceStyles.js";

/** The resizable meter strip. Accessory chrome lives in sibling windows. */
/**
 * @param {{
 *   panels?: any[],
 *   controls: import("./dockModuleControls.js").DockStripControls,
 *   hoveredPanelId?: string,
 *   edge?: string,
 *   height?: number,
 *   heightResizeDisabled?: boolean,
 *   onHeightChange?: (...args: any[]) => any,
 *   panelSizesById?: any,
 *   panelResizeDisabled?: boolean,
 *   onPanelResize?: (...args: any[]) => any,
 *   onPanelResizeReset?: (...args: any[]) => any,
 *   onPointerEnter?: (...args: any[]) => any,
 *   onPointerLeave?: (...args: any[]) => any,
 *   recordingState?: any,
 * }} props
 */
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
  recordingState = null,
}) {
  const heightMode = dockHeightMode(height);
  return (
    <div
      data-testid="dock-strip"
      data-visual-capture-surface="main"
      data-visual-capture-ready="true"
      data-height-mode={heightMode}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className={cn(
        "dock-strip relative h-screen w-screen select-none overflow-hidden text-foreground",
        DOCK_SURFACE_CLASS
      )}
    >
      <DockHeightResizeHandle
        edge={edge}
        height={height}
        disabled={heightResizeDisabled}
        onHeightChange={onHeightChange}
      />
      <div className="flex h-full min-w-0 items-stretch">
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
                "relative",
                hoveredPanelId === panel.id && "relative z-10 ring-2 ring-inset ring-primary"
              )}
              style={{
                minWidth: entry.minWidth,
                maxWidth: entry.maxPreferredWidth,
                flex: `${entry.growthPolicy === "flexible" ? 1 : 0} 1 ${basis}px`,
              }}
            >
              <Component
                heightMode={heightMode}
                controls={{
                  ...controls,
                  ...controls.controlsByPanelId?.[panel.id],
                  panelId: panel.id,
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
      <RecordingIndicator state={recordingState} />
    </div>
  );
}
