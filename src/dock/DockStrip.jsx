import { readPersistedInterfaceSize } from "../preferences/interfaceSize.js";
import { getDockPanelSizing, fitDockPanelWidths } from "./dockPanelSizing.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePanelChromeData, useHistoryData } from "../workspace/AudioDataContext.jsx";
import { DOCK_MODULE_REGISTRY } from "./registry.jsx";
import { dockModuleIdForPanelModuleId } from "./dockLayout.js";
import { cn } from "@/lib/utils";
import { DockHeightResizeHandle } from "./DockHeightResizeHandle.jsx";
import { DockPanelResizeHandle } from "./DockPanelResizeHandle.jsx";
import { DockControlArea } from "./DockControlArea.jsx";
import { dockMinHeight } from "./dockSizing.js";
import { RecordingIndicator } from "../components/RecordingIndicator.jsx";
import { DOCK_SURFACE_CLASS } from "../components/ui/surfaceStyles.js";

/** The resizable meter strip. Accessory chrome lives in sibling windows. */
/**
 * @param {{
 *   panels?: any[],
 *   interfaceSize?: string,
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
 *   toolbarOpen?: boolean,
 *   onToolbarToggle?: () => void,
 *   onRestoreWindow?: () => void,
 *   updateStatus?: { phase: string, label: string } | null,
 *   statusItems?: import("../lib/appStatus.js").AppStatusItem[],
 *   recordingState?: string | null,
 * }} props
 */
export function DockStrip({
  panels = [],
  interfaceSize = readPersistedInterfaceSize(),
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
  toolbarOpen = false,
  onToolbarToggle,
  onRestoreWindow,
  updateStatus = null,
  statusItems = [],
  recordingState = null,
}) {
  const chrome = usePanelChromeData();
  const showAxes = chrome?.hideAxesAndLabels !== true;
  const channelCount = chrome?.channelCount ?? 2;
  const viewportRef = useRef(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [, refreshFontMetrics] = useState(0);
  // Height of the horizontal scrollbar that appears when the panels are wider than the screen.
  const [scrollbarHeight, setScrollbarHeight] = useState(0);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const measure = () => {
      setAvailableWidth(viewport.clientWidth);
      setScrollbarHeight(Math.max(0, viewport.offsetHeight - viewport.clientHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    const onFontsLoaded = () => refreshFontMetrics((revision) => revision + 1);
    document.fonts?.addEventListener("loadingdone", onFontsLoaded);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", onFontsLoaded);
    };
  }, []);
  const entries = panels.map((panel) => {
    const sizing = getDockPanelSizing(panel.moduleId, interfaceSize, showAxes, {
      controls: controls.controlsByPanelId?.[panel.id],
      channelCount,
      height: height - scrollbarHeight,
    });
    return {
      id: panel.id,
      ...sizing,
      preferredWidth: panelSizesById[panel.id] ?? sizing.defaultWidth,
      autoStats: panel.moduleId === "stats" && panelSizesById[panel.id] == null,
    };
  });
  const renderedWidths = fitDockPanelWidths(
    entries,
    availableWidth || entries.reduce((sum, entry) => sum + entry.preferredWidth, 0)
  );
  const resizeContext = () => ({
    // Freeze current display geometry for the gesture, so untouched panels do not jump.
    renderedWidths,
    channelCount,
    automaticPanelIds: entries.filter((entry) => entry.autoStats).map((entry) => entry.id),
  });
  // The scrollbar takes its height from the panels, so reserve it to keep three Stats rows visible.
  const minHeight = dockMinHeight(interfaceSize) + scrollbarHeight;
  // A larger interface size or an overflowing panel row raises the minimum; grow a shorter strip.
  useEffect(() => {
    if (Number.isFinite(height) && height < minHeight && !heightResizeDisabled)
      void Promise.resolve(onHeightChange?.(minHeight, { persist: true })).catch(() => {});
  }, [height, minHeight, heightResizeDisabled, onHeightChange]);
  const history = useHistoryData();
  const isSnapshot = history?.selectedOffset >= 0;
  return (
    <div
      data-testid="dock-strip"
      data-visual-capture-surface="main"
      data-visual-capture-ready="true"
      data-history={isSnapshot ? "" : undefined}
      className={cn(
        "dock-strip relative h-screen w-screen select-none overflow-hidden text-foreground",
        DOCK_SURFACE_CLASS
      )}
    >
      <DockHeightResizeHandle
        edge={edge}
        height={height}
        minHeight={minHeight}
        disabled={heightResizeDisabled}
        onHeightChange={onHeightChange}
      />
      <div className="flex h-full min-w-0 items-stretch">
        <div
          ref={viewportRef}
          tabIndex={0}
          role="region"
          aria-label="dock panels"
          className="dock-panel-viewport flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden"
        >
          {panels.map((panel, index) => {
            const dockModuleId = dockModuleIdForPanelModuleId(panel.moduleId) ?? panel.moduleId;
            const entry = DOCK_MODULE_REGISTRY[dockModuleId];
            if (!entry) return null;
            const { Component } = entry;
            const basis = renderedWidths[panel.id];
            const nextPanel = panels[index + 1];
            const nextDockModuleId = nextPanel
              ? (dockModuleIdForPanelModuleId(nextPanel.moduleId) ?? nextPanel.moduleId)
              : null;
            const nextEntry = nextDockModuleId ? DOCK_MODULE_REGISTRY[nextDockModuleId] : null;
            return (
              <div
                key={panel.id}
                data-testid="dock-module"
                data-module-id={dockModuleId}
                data-panel-id={panel.id}
                data-hover-highlighted={hoveredPanelId === panel.id ? "true" : undefined}
                className={cn(
                  "relative",
                  hoveredPanelId === panel.id && "relative z-10 ring-2 ring-inset ring-primary"
                )}
                style={{
                  minWidth: entries[index].minWidth,
                  flex: `0 0 ${basis}px`,
                }}
              >
                <Component
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
                    rightBasis={renderedWidths[nextPanel.id]}
                    getResizeContext={resizeContext}
                    disabled={panelResizeDisabled}
                    onResize={onPanelResize}
                    onReset={onPanelResizeReset}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <DockControlArea
          edge={edge}
          toolbarOpen={toolbarOpen}
          onToolbarToggle={onToolbarToggle}
          onRestore={onRestoreWindow}
          transport={controls.sourceTransportState}
          onTransport={controls.onSourceTransportAction}
          update={updateStatus}
          statusItems={statusItems}
        />
      </div>
      <RecordingIndicator
        state={recordingState}
        className="right-[calc(var(--ui-dock-toolbar-toggle-w)+0.25rem)]"
      />
    </div>
  );
}
