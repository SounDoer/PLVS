import { Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { useDrag } from "./DragContext.jsx";
import { AudioDataContext, useAudioData } from "./AudioDataContext.jsx";
import { PanelHeaderControls } from "../components/PanelHeaderControls.jsx";
import {
  resolvePanelDefinition,
  resolvePanelDisplayName,
  resolvePanelModuleId,
} from "./panelInstances.js";
import { getPanelControls } from "./panelControlInstances.js";

const noop = () => {};

// ---------------------------------------------------------------------------
// TabPill
// ---------------------------------------------------------------------------

function TabPill({ tabId, isActive, path, slotTabIndex }) {
  const { state, setActiveTab } = useWorkspaceStore();
  const { dragState, onTabMouseDown } = useDrag();
  const def = resolvePanelDefinition(state, tabId);
  if (!def) return null;
  const title = resolvePanelDisplayName(state, tabId);

  const isSourceTab = dragState?.sourceId === tabId;

  return (
    <div
      data-tab-pill
      data-tab-pill-index={slotTabIndex}
      className={cn(
        "flex items-center gap-1 rounded-t-[5px] px-2 py-0.5 text-xs font-medium select-none cursor-pointer transition-colors",
        isActive
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        isSourceTab && "opacity-35"
      )}
      onMouseDown={(e) => onTabMouseDown(e, tabId)}
      onClick={() => !dragState && setActiveTab(path, tabId)}
    >
      <span className="flex shrink-0">
        <def.Icon />
      </span>
      <span className="truncate max-w-[8rem]">{title}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone hint helpers
// ---------------------------------------------------------------------------

function getZoneHint(hoverDrop, path) {
  if (!hoverDrop) return null;
  const pathStr = JSON.stringify(path);
  const dropStr = JSON.stringify(hoverDrop.targetPath);
  if (pathStr !== dropStr) return null;
  return hoverDrop.zone;
}

function getTabInsertX(tabIndex, totalTabs) {
  if (totalTabs === 0 || tabIndex === 0) return "4px";
  if (tabIndex >= totalTabs) return "calc(100% - 4px)";
  return `${Math.round((tabIndex / totalTabs) * 100)}%`;
}

// ---------------------------------------------------------------------------
// LeafView
// ---------------------------------------------------------------------------

export function LeafView({ node, path, style }) {
  const { state, removePanel, setFullscreen, setPanelControlsForPanel } = useWorkspaceStore();
  const { dragState, hoverDrop } = useDrag();
  const audioData = useAudioData();
  const compactPanels = audioData?.compactPanels === true;

  const visibleTabs = node.tabs.filter((id) => state.panelsById[id]);
  const activeTab = visibleTabs.includes(node.activeTab) ? node.activeTab : visibleTabs[0];
  const ActiveComponent = activeTab ? resolvePanelDefinition(state, activeTab)?.Component : null;
  const activeModuleId = activeTab ? resolvePanelModuleId(state, activeTab) : null;
  const panelControls = activeTab ? getPanelControls(state, activeTab) : null;
  const onPanelControlsChange = activeTab
    ? (nextPanelControls) => setPanelControlsForPanel(activeTab, nextPanelControls)
    : audioData?.onPanelControlsChange;
  const panelAudioData =
    activeTab && audioData
      ? {
          ...audioData,
          panelControls,
          onPanelControlsChange,
          analysisStatus: audioData.analysisStatusByPanelId?.[activeTab],
        }
      : audioData;
  const zoneHint = getZoneHint(hoverDrop, path);
  const isDragging = !!dragState;
  const pathAttr = JSON.stringify(path);

  return (
    <div
      data-leaf
      data-leaf-path={pathAttr}
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden rounded-[10px] border bg-card/55 shadow-sm backdrop-blur-md transition-[border-color,box-shadow] duration-150",
        "border-border/80 hover:border-border",
        isDragging &&
          (zoneHint === "above" || zoneHint === "below") &&
          "ring-2 ring-primary ring-offset-0",
        isDragging &&
          (zoneHint === "left" || zoneHint === "right") &&
          "ring-2 ring-primary ring-offset-0"
      )}
      style={style}
    >
      {/* Zone hint: above */}
      {isDragging && zoneHint === "above" && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-1/2 items-start justify-center rounded-t-[10px] border-t-2 border-dashed border-primary bg-primary/5 pt-2 text-[10px] text-primary">
          Insert above
        </div>
      )}

      {/* Zone hint: below */}
      {isDragging && zoneHint === "below" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-1/2 items-end justify-center rounded-b-[10px] border-b-2 border-dashed border-primary bg-primary/5 pb-2 text-[10px] text-primary">
          Insert below
        </div>
      )}

      {/* Zone hint: left */}
      {isDragging && zoneHint === "left" && (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex w-1/2 items-center justify-center rounded-l-[10px] border-l-2 border-dashed border-primary bg-primary/5 text-[10px] text-primary">
          Insert left
        </div>
      )}

      {/* Zone hint: right */}
      {isDragging && zoneHint === "right" && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-1/2 items-center justify-center rounded-r-[10px] border-r-2 border-dashed border-primary bg-primary/5 text-[10px] text-primary">
          Insert right
        </div>
      )}

      {/* Slot header: tab bar + action buttons */}
      {!compactPanels && (
        <div
          data-leaf-tabs
          className={cn(
            "relative flex h-9 shrink-0 items-center gap-0.5 border-b border-border/60 bg-card px-1",
            isDragging && zoneHint === "tabs" && "border-t-2 border-t-primary"
          )}
        >
          {/* Tab insertion indicator */}
          {isDragging && zoneHint === "tabs" && (
            <div
              className="pointer-events-none absolute bottom-0 top-0 w-0.5 bg-primary"
              style={{ left: getTabInsertX(hoverDrop?.tabIndex, visibleTabs.length) }}
            />
          )}

          {visibleTabs.map((tabId, i) => (
            <TabPill
              key={tabId}
              tabId={tabId}
              isActive={tabId === activeTab}
              path={path}
              slotTabIndex={i}
            />
          ))}

          <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1">
            <PanelHeaderControls
              activeTab={activeModuleId}
              channelCount={audioData?.channelCount ?? 0}
              vectorscopeOptions={audioData?.vectorscopePairOptions ?? []}
              vectorscopeValueKey={audioData?.vectorscopeValueKey ?? ""}
              vectorscopeDisplayLabel={audioData?.vectorscopeDisplayLabel ?? ""}
              onVectorscopeChange={noop}
              spectrumOptions={audioData?.spectrumChannelOptions ?? []}
              spectrumValueKey={audioData?.spectrumValueKey ?? ""}
              spectrumDisplayLabel={audioData?.spectrumDisplayLabel ?? ""}
              onSpectrumChange={noop}
              spectrumView={audioData?.spectrumView ?? "combined"}
              spectrumViewLegend={audioData?.spectrumViewLegend ?? null}
              onSpectrumViewChange={noop}
              spectrumPeakHold={audioData?.spectrumPeakHold ?? false}
              onSpectrumPeakHoldToggle={noop}
              panelControls={panelControls ?? audioData?.panelControls}
              onPanelControlsChange={onPanelControlsChange}
            />
            <button
              type="button"
              aria-label="Fullscreen"
              className="rounded p-0.5 text-muted-foreground opacity-50 hover:opacity-100 focus-visible:outline-none"
              onClick={() => activeTab && setFullscreen(activeTab)}
            >
              <Maximize2 size={12} />
            </button>
            <button
              type="button"
              aria-label="Hide all in panel"
              className="rounded p-0.5 text-muted-foreground opacity-50 hover:opacity-100 focus-visible:outline-none"
              onClick={() => visibleTabs.forEach((id) => removePanel(id))}
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Panel body */}
      <div data-leaf-body className="flex min-h-0 flex-1 overflow-hidden">
        {ActiveComponent && (
          <AudioDataContext.Provider value={panelAudioData}>
            <ActiveComponent />
          </AudioDataContext.Provider>
        )}
      </div>
    </div>
  );
}
