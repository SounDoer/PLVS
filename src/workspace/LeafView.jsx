import { useCallback, useMemo, useRef } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Maximize2,
  Pin,
  PinOff,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PANEL_SURFACE_CLASS } from "@/components/ui/surfaceStyles.js";
import {
  PANEL_HEADER_ACTION_BUTTON,
  PANEL_HEADER_ACTIONS,
  PANEL_HEADER_BAR,
  PANEL_HEADER_PIN_ICON,
} from "@/lib/shellLayout";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { useDrag } from "./DragContext.jsx";
import { PanelInstanceProvider, usePanelChromeData } from "./AudioDataContext.jsx";
import { usePanelHistoryData } from "../hooks/usePanelHistoryData.js";
import { usePanelAxisViewports } from "./axisViewportHooks.js";
import { HelpPopover } from "../components/HelpPopover.jsx";
import { HoverTip } from "@/components/HoverTip";
import { PanelSettingsMenu } from "../components/PanelSettingsMenu.jsx";
import { resolvePanelHelpItems } from "../components/panels/chartHelp.js";
import { PanelTitleGroup } from "./PanelTitleGroup.jsx";
import { resolvePanelDisplayName, resolvePanelModuleId } from "./panelInstances.js";
import { resolvePanelDefinition } from "./registry.jsx";
import { getPanelControls } from "./panelControlInstances.js";
import { IconAction } from "@/components/ui/icon-action";

const noop = () => {};

// ---------------------------------------------------------------------------
// TabPill
// ---------------------------------------------------------------------------

function TabPill({ tabId, isActive, path, slotTabIndex, showClose }) {
  const { state, setActiveTab, removePanel } = useWorkspaceStore();
  const { dragState, onTabMouseDown } = useDrag();
  const def = resolvePanelDefinition(state, tabId);
  if (!def) return null;
  const title = resolvePanelDisplayName(state, tabId);

  const isSourceTab = dragState?.payload?.kind === "move" && dragState.payload.id === tabId;

  return (
    <div
      data-tab-pill
      data-tab-pill-index={slotTabIndex}
      className={cn(
        // `min-w-0` lets the title truncate before the header actions are pushed out of a narrow
        // panel, where they would be clipped and unreachable.
        "group flex min-w-0 items-center rounded-t-xs",
        isActive
          ? "text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-ui-hover",
        isSourceTab && "opacity-35"
      )}
    >
      <PanelTitleGroup
        icon={def.Icon}
        title={title}
        className="select-none cursor-pointer"
        onMouseDown={(e) => onTabMouseDown(e, tabId)}
        onClick={() => !dragState && setActiveTab(path, tabId)}
      />
      {/* Only when this slot has more than one tab: with a single tab, the leaf header's own
          `X` ("Hide all in panel") already closes it, so a second close control here would be
          redundant. */}
      {showClose ? (
        <IconAction
          aria-label={`Close ${title}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            removePanel(tabId);
          }}
          className={cn(
            PANEL_HEADER_ACTION_BUTTON,
            "mr-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
            isActive && "opacity-100"
          )}
        >
          <X className="size-[length:var(--ui-icon-panel-action)]" />
        </IconAction>
      ) : null}
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

const DROP_ZONE_PRESENTATION = {
  above: { label: "Place Above", Icon: ArrowUp },
  below: { label: "Place Below", Icon: ArrowDown },
  left: { label: "Place Left", Icon: ArrowLeft },
  right: { label: "Place Right", Icon: ArrowRight },
};

function DropHint({ Icon, label, panelTitle, className }) {
  return (
    <div
      data-drop-hint
      className={cn(
        "pointer-events-none flex max-w-[calc(100%_-_1rem)] flex-col items-center px-2 py-1 text-center leading-tight",
        className
      )}
    >
      <div className="max-w-full truncate text-[length:var(--ui-fs-control)] font-semibold text-foreground">
        {panelTitle}
      </div>
      <div className="mt-0.5 flex items-center gap-1 whitespace-nowrap text-[length:var(--ui-fs-caption)] font-medium text-primary">
        <Icon className="size-[length:var(--ui-icon-panel-action)] shrink-0" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function DropPlacementPreview({ zone, panelTitle }) {
  const presentation = DROP_ZONE_PRESENTATION[zone];
  if (!presentation) return null;
  const { Icon, label } = presentation;
  const placementClass = {
    above: "inset-x-0 top-0 h-1/2 rounded-t-md",
    below: "inset-x-0 bottom-0 h-1/2 rounded-b-md",
    left: "inset-y-0 left-0 w-1/2 rounded-l-md",
    right: "inset-y-0 right-0 w-1/2 rounded-r-md",
  }[zone];

  return (
    <div
      data-drop-preview
      data-drop-zone={zone}
      className={cn(
        "pointer-events-none absolute z-20 flex items-center justify-center",
        placementClass
      )}
      style={{
        backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)",
      }}
    >
      <DropHint Icon={Icon} label={label} panelTitle={panelTitle} />
    </div>
  );
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
    resetPanelControlsForPanel,
    setPanelPinned,
    hoveredPanelId,
  } = useWorkspaceStore();
  const leafRef = useRef(null);
  const { dragState, dragLabel, hoverDrop } = useDrag();
  const chromeData = usePanelChromeData();
  const compactPanels = chromeData?.compactPanels === true;

  const visibleTabs = node.tabs.filter((id) => state.panelsById[id]);
  const activeTab = visibleTabs.includes(node.activeTab) ? node.activeTab : visibleTabs[0];
  const ActiveComponent = activeTab ? resolvePanelDefinition(state, activeTab)?.Component : null;
  const activeModuleId = activeTab ? resolvePanelModuleId(state, activeTab) : null;
  const panelControls = activeTab ? getPanelControls(state, activeTab) : null;
  const helpItems = activeModuleId ? resolvePanelHelpItems(activeModuleId, panelControls) : null;
  const onPanelControlsChange = useCallback(
    (nextPanelControls) => {
      if (!activeTab) return;
      setPanelControlsForPanel(activeTab, nextPanelControls);
    },
    [activeTab, setPanelControlsForPanel]
  );
  const onPanelControlsReset = useCallback(() => {
    if (!activeTab) return;
    resetPanelControlsForPanel(activeTab);
  }, [activeTab, resetPanelControlsForPanel]);
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
  const axisViewportData = usePanelAxisViewports(activeTab);
  const panelHistoryData = usePanelHistoryData(activeModuleId, axisViewportData);
  const panelInstanceData = useMemo(
    () => ({
      panelControls,
      onPanelControlsChange: activeTab ? onPanelControlsChange : undefined,
      ...axisViewportData,
      historyData: panelHistoryData,
      panelVisible: !state.fullscreenId,
    }),
    [
      activeTab,
      axisViewportData,
      onPanelControlsChange,
      panelControls,
      panelHistoryData,
      state.fullscreenId,
    ]
  );

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
    // A pin locks the panel's width and height. Each dimension is consumed by the
    // nearest ancestor split of the matching direction (nearest h-split for width,
    // nearest v-split for height); ancestors further up in an already-consumed
    // direction are unaffected, so we must not renormalize them — doing so starves
    // their siblings (e.g. collapsing the whole top region under Loudness).
    let consumedH = false;
    let consumedV = false;
    for (let depth = path.length - 1; depth >= 0; depth--) {
      const splitEl = childEl?.parentElement;
      const parentPath = path.slice(0, depth);
      const parentNode = getNodeAtPath(state.tree, parentPath);
      if (!splitEl || parentNode?.type !== "split") break;
      const isH = parentNode.direction === "h";
      childEl = splitEl;
      if (isH ? consumedH : consumedV) continue;
      if (isH) consumedH = true;
      else consumedV = true;
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
      data-visual-panel-id={activeTab}
      data-visual-capture-ready={activeTab ? "true" : undefined}
      className={cn(
        "relative flex min-h-0 flex-col overflow-hidden rounded-md",
        PANEL_SURFACE_CLASS,
        isPanelHoverHighlighted && "ring-2 ring-primary ring-offset-0",
        isDragging && zoneHint && "ring-1 ring-primary ring-offset-0"
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
      }}
    >
      {isDragging && DROP_ZONE_PRESENTATION[zoneHint] ? (
        <DropPlacementPreview zone={zoneHint} panelTitle={dragLabel} />
      ) : null}

      {/* Slot header: tab bar + action buttons */}
      {!compactPanels && (
        <div data-leaf-tabs className={PANEL_HEADER_BAR}>
          {/* Tab placement hint */}
          {isDragging && zoneHint === "tabs" && (
            <DropHint
              Icon={Plus}
              label="Add as Tab"
              panelTitle={dragLabel}
              className="absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2"
            />
          )}

          {visibleTabs.map((tabId, i) => (
            <TabPill
              key={tabId}
              tabId={tabId}
              isActive={tabId === activeTab}
              path={path}
              slotTabIndex={i}
              showClose={visibleTabs.length > 1}
            />
          ))}

          <div className={PANEL_HEADER_ACTIONS}>
            <PanelInstanceProvider value={panelInstanceData}>
              <PanelSettingsMenu
                activeTab={activeModuleId}
                panelTitle={activeTab ? resolvePanelDisplayName(state, activeTab) : undefined}
                channelCount={chromeData?.channelCount ?? 0}
                vectorscopeOptions={chromeData?.vectorscopePairOptions ?? []}
                vectorscopeValueKey={chromeData?.vectorscopeValueKey ?? ""}
                vectorscopeDisplayLabel={chromeData?.vectorscopeDisplayLabel ?? ""}
                onVectorscopeChange={noop}
                stereoMapPairOptions={chromeData?.stereoMapPairOptions ?? []}
                stereoMapPairValueKey={chromeData?.stereoMapPairValueKey ?? ""}
                stereoMapPairDisplayLabel={chromeData?.stereoMapPairDisplayLabel ?? ""}
                onStereoMapPairChange={noop}
                spectrumOptions={chromeData?.spectrumChannelOptions ?? []}
                spectrumValueKey={chromeData?.spectrumValueKey ?? ""}
                spectrumDisplayLabel={chromeData?.spectrumDisplayLabel ?? ""}
                onSpectrumChange={noop}
                spectrumView={chromeData?.spectrumView ?? "combined"}
                spectrumViewLegend={chromeData?.spectrumViewLegend ?? null}
                onSpectrumViewChange={noop}
                spectrumMaxMode={chromeData?.spectrumMaxMode ?? "off"}
                onSpectrumMaxModeChange={noop}
                panelControls={panelControls}
                onPanelControlsChange={onPanelControlsChange}
                onPanelControlsReset={onPanelControlsReset}
              />
            </PanelInstanceProvider>
            {helpItems ? <HelpPopover items={helpItems} /> : null}
            <HoverTip
              tip={
                slotPinnedByOther
                  ? `Slot size locked by ${slotPinnedTitle}`
                  : isActivePinned
                    ? "Unpin panel size"
                    : "Pin panel size"
              }
            >
              <IconAction
                aria-label={isActivePinned ? "Unpin panel size" : "Pin panel size"}
                aria-pressed={isActivePinned}
                className={cn(
                  PANEL_HEADER_ACTION_BUTTON,
                  (isActivePinned || slotPinnedByOther) && "text-foreground"
                )}
                onClick={handlePinClick}
              >
                {isActivePinned ? (
                  <PinOff className={PANEL_HEADER_PIN_ICON} />
                ) : (
                  <Pin className={PANEL_HEADER_PIN_ICON} />
                )}
              </IconAction>
            </HoverTip>
            <IconAction
              aria-label="Fullscreen"
              className={PANEL_HEADER_ACTION_BUTTON}
              onClick={() => activeTab && setFullscreen(activeTab)}
            >
              <Maximize2 className="size-[length:var(--ui-icon-panel-action)]" />
            </IconAction>
            <IconAction
              aria-label="Hide all in panel"
              className={PANEL_HEADER_ACTION_BUTTON}
              onClick={() => visibleTabs.forEach((id) => removePanel(id))}
            >
              <X className="size-[length:var(--ui-icon-panel-action)]" />
            </IconAction>
          </div>
        </div>
      )}
      {/* Panel body */}
      <div data-leaf-body className="flex min-h-0 flex-1 overflow-hidden">
        {ActiveComponent && (
          <PanelInstanceProvider value={panelInstanceData}>
            <ActiveComponent compact={compactPanels} />
          </PanelInstanceProvider>
        )}
      </div>
    </div>
  );
}
