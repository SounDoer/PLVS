import { useRef } from "react";
import { Maximize2, Pin, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PANEL_HEADER_ACTION_BUTTON,
  PANEL_HEADER_ACTIONS,
  PANEL_HEADER_BAR,
} from "@/lib/shellLayout";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { useDrag } from "./DragContext.jsx";
import { AudioDataContext, useAudioData } from "./AudioDataContext.jsx";
import { PanelSettingsMenu } from "../components/PanelSettingsMenu.jsx";
import { PanelTitleGroup } from "./PanelTitleGroup.jsx";
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
    <PanelTitleGroup
      data-tab-pill
      data-tab-pill-index={slotTabIndex}
      icon={def.Icon}
      title={title}
      className={cn(
        "rounded-t-[5px] select-none cursor-pointer transition-colors",
        isActive
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        isSourceTab && "opacity-35"
      )}
      onMouseDown={(e) => onTabMouseDown(e, tabId)}
      onClick={() => !dragState && setActiveTab(path, tabId)}
    />
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

function getNodeAtPath(root, path) {
  let node = root;
  for (const idx of path) {
    node = node?.children?.[idx];
  }
  return node ?? null;
}

function nodeHasVisiblePanels(node, panelsById) {
  if (!node) return false;
  if (node.type === "leaf") return node.tabs.some((id) => panelsById[id]);
  return node.children.some((child) => nodeHasVisiblePanels(child, panelsById));
}

function getMeasuredSize(el, dimension) {
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  const value = dimension === "width" ? rect.width : rect.height;
  const fallback = dimension === "width" ? el.offsetWidth : el.offsetHeight;
  return value || fallback || 0;
}

// ---------------------------------------------------------------------------
// LeafView
// ---------------------------------------------------------------------------

export function LeafView({ node, path, style }) {
  const {
    state,
    removePanel,
    setFullscreen,
    setPanelControlsForPanel,
    setPanelPinned,
    hoveredPanelId,
  } = useWorkspaceStore();
  const leafRef = useRef(null);
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
  const isPanelHoverHighlighted = hoveredPanelId != null && visibleTabs.includes(hoveredPanelId);
  const pinnedPanelsById = state.pinnedPanelsById ?? {};
  const slotPinnedId = visibleTabs.find((id) => pinnedPanelsById[id]) ?? null;
  const slotPinnedSize = slotPinnedId ? pinnedPanelsById[slotPinnedId] : null;
  const isActivePinned = activeTab ? Boolean(pinnedPanelsById[activeTab]) : false;
  const slotPinnedByOther = Boolean(slotPinnedId && slotPinnedId !== activeTab);
  const slotPinnedTitle = slotPinnedId ? resolvePanelDisplayName(state, slotPinnedId) : "";
  const pathAttr = JSON.stringify(path);

  function getCurrentLeafSize() {
    const el = leafRef.current;
    if (!el) return { width: 0, height: 0 };
    const rect = el.getBoundingClientRect();
    return {
      width: rect.width || el.offsetWidth || 0,
      height: rect.height || el.offsetHeight || 0,
    };
  }

  function getSplitSnapshots() {
    const snapshots = [];
    let childEl = leafRef.current;
    for (let depth = path.length - 1; depth >= 0; depth--) {
      const splitEl = childEl?.parentElement;
      const parentPath = path.slice(0, depth);
      const parentNode = getNodeAtPath(state.tree, parentPath);
      if (!splitEl || parentNode?.type !== "split") break;
      const isH = parentNode.direction === "h";
      const childElements = Array.from(splitEl.children).filter(
        (el) => el.hasAttribute("data-leaf") || el.hasAttribute("data-split")
      );
      const visibleChildIndices = parentNode.children
        .map((child, idx) => (nodeHasVisiblePanels(child, state.panelsById) ? idx : null))
        .filter((idx) => idx !== null);
      snapshots.push({
        path: parentPath,
        childIdx: path[depth],
        mode: isActivePinned ? "unpin" : "pin",
        children: visibleChildIndices.map((childIdx, renderIdx) => {
          const el = childElements[renderIdx];
          return {
            childIdx,
            sizePx: getMeasuredSize(el, isH ? "width" : "height"),
          };
        }),
      });
      childEl = splitEl;
    }
    return snapshots;
  }

  function handlePinClick(e) {
    e.stopPropagation();
    if (!activeTab) return;
    setPanelPinned(activeTab, isActivePinned ? null : getCurrentLeafSize(), {
      splitSnapshots: getSplitSnapshots(),
    });
  }

  return (
    <div
      ref={leafRef}
      data-leaf
      data-leaf-path={pathAttr}
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden rounded-[10px] shadow-sm backdrop-blur-[24px] transition-[border-color,box-shadow] duration-150",
        "border border-[color:color-mix(in_srgb,var(--border)_var(--panel-opacity),transparent)] hover:border-border",
        isPanelHoverHighlighted && "border-primary/70 ring-2 ring-primary/60 ring-offset-0",
        isDragging &&
          (zoneHint === "above" || zoneHint === "below") &&
          "ring-2 ring-primary ring-offset-0",
        isDragging &&
          (zoneHint === "left" || zoneHint === "right") &&
          "ring-2 ring-primary ring-offset-0"
      )}
      style={{
        ...style,
        ...(slotPinnedSize
          ? {
              width: slotPinnedSize.width,
              height: slotPinnedSize.height,
              alignSelf: "flex-start",
            }
          : null),
        backgroundColor:
          "color-mix(in srgb, var(--card) var(--panel-opacity-card, 55%), transparent)",
      }}
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
            PANEL_HEADER_BAR,
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

          <div className={PANEL_HEADER_ACTIONS}>
            <PanelSettingsMenu
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
              aria-label={isActivePinned ? "Unpin panel size" : "Pin panel size"}
              aria-pressed={isActivePinned}
              title={
                slotPinnedByOther
                  ? `Slot size locked by ${slotPinnedTitle}`
                  : isActivePinned
                    ? "Unpin panel size"
                    : "Pin panel size"
              }
              className={cn(
                PANEL_HEADER_ACTION_BUTTON,
                (isActivePinned || slotPinnedByOther) && "text-primary opacity-100"
              )}
              onClick={handlePinClick}
            >
              <Pin size={12} fill={isActivePinned ? "currentColor" : "none"} />
            </button>
            <button
              type="button"
              aria-label="Fullscreen"
              className={PANEL_HEADER_ACTION_BUTTON}
              onClick={() => activeTab && setFullscreen(activeTab)}
            >
              <Maximize2 size={12} />
            </button>
            <button
              type="button"
              aria-label="Hide all in panel"
              className={PANEL_HEADER_ACTION_BUTTON}
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
            <ActiveComponent compact={compactPanels} />
          </AudioDataContext.Provider>
        )}
      </div>
    </div>
  );
}
