import { Fragment, memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PANEL_HEADER_ACTION_BUTTON,
  PANEL_HEADER_ACTIONS,
  PANEL_HEADER_BAR,
} from "@/lib/shellLayout";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { DragProvider, useDrag } from "./DragContext.jsx";
import { LeafView } from "./LeafView.jsx";
import { PanelInstanceProvider, usePanelChromeData } from "./AudioDataContext.jsx";
import { HelpPopover } from "../components/HelpPopover.jsx";
import { HoverTip } from "@/components/HoverTip";
import { PanelSettingsMenu } from "../components/PanelSettingsMenu.jsx";
import { PANEL_HELP_BY_MODULE_ID } from "../components/panels/chartHelp.js";
import { PanelTitleGroup } from "./PanelTitleGroup.jsx";
import {
  resolvePanelDefinition,
  resolvePanelDisplayName,
  resolvePanelModuleId,
} from "./panelInstances.js";
import { getPanelControls } from "./panelControlInstances.js";

const SPLIT_DIVIDER_SIZE_REM = 0.375;
const noop = () => {};

// ---------------------------------------------------------------------------
// Empty-node helper and min-size helper for a subtree
// ---------------------------------------------------------------------------

function isNodeEmpty(node, panelsById) {
  if (node.type === "leaf") {
    return !node.tabs.some((id) => panelsById[id]);
  }
  return node.children.every((c) => isNodeEmpty(c, panelsById));
}

function getSubtreeMinSize(node, state, dimension) {
  if (node.type === "leaf") {
    const mins = node.tabs
      .filter((id) => state.panelsById[id])
      .map((id) => resolvePanelDefinition(state, id)?.[dimension] ?? 0);
    return mins.length > 0 ? Math.max(...mins) : 0;
  }
  const childMins = node.children
    .filter((c) => !isNodeEmpty(c, state.panelsById))
    .map((c) => getSubtreeMinSize(c, state, dimension));
  if (childMins.length === 0) return 0;
  const isAdditive =
    (dimension === "minWidth" && node.direction === "h") ||
    (dimension === "minHeight" && node.direction === "v");
  return isAdditive ? childMins.reduce((a, b) => a + b, 0) : Math.max(...childMins);
}

function formatFlexFactor(value) {
  return Number(value.toFixed(6)).toString();
}

function formatPx(value) {
  return Number(value.toFixed(3)).toString();
}

export function getSplitSizingContext(visibleSizes, dividerCount, pinnedPixels = []) {
  const isPinned = (i) => Number.isFinite(pinnedPixels[i]) && pinnedPixels[i] > 0;
  const fixedSizes = visibleSizes.filter((s, i) => s !== null && !isPinned(i));
  const fixedTotal = fixedSizes.reduce((sum, s) => sum + s, 0);
  const unpinnedCount = visibleSizes.filter((_, i) => !isPinned(i)).length;
  const pinnedTotalPx = pinnedPixels.reduce(
    (sum, px) => (Number.isFinite(px) && px > 0 ? sum + px : sum),
    0
  );
  return {
    dividerTotalRem: dividerCount * SPLIT_DIVIDER_SIZE_REM,
    fixedTotal,
    normalizeFixed: fixedSizes.length === unpinnedCount || fixedTotal >= 1,
    pinnedTotalPx,
  };
}

export function getSplitChildStyle(size, sizingContext, pinnedPx = null) {
  const baseStyle = { minWidth: 0, minHeight: 0 };
  if (Number.isFinite(pinnedPx) && pinnedPx > 0) {
    return { flex: `0 0 ${formatPx(pinnedPx)}px`, ...baseStyle };
  }
  if (size === null) return { flex: "1 1 0", ...baseStyle };

  const divisor = sizingContext.normalizeFixed ? sizingContext.fixedTotal : 1;
  const factor = formatFlexFactor(size / divisor);
  const dividerTotalRem = formatFlexFactor(sizingContext.dividerTotalRem);
  const pinnedTotalPx = formatFlexFactor(sizingContext.pinnedTotalPx ?? 0);
  const availableSpace =
    sizingContext.pinnedTotalPx > 0
      ? `100% - ${dividerTotalRem}rem - ${pinnedTotalPx}px`
      : `100% - ${dividerTotalRem}rem`;
  return { flex: `0 0 calc((${availableSpace}) * ${factor})`, ...baseStyle };
}

function getPinnedSizesForNode(node, state, dimension) {
  if (!node || !state.pinnedPanelsById) return [];
  if (node.type === "leaf") {
    return node.tabs
      .map((id) => state.pinnedPanelsById[id]?.[dimension])
      .filter((size) => Number.isFinite(size) && size > 0);
  }
  const consumesDimension =
    (node.direction === "h" && dimension === "width") ||
    (node.direction === "v" && dimension === "height");
  if (consumesDimension) return [];
  return node.children.flatMap((child) => getPinnedSizesForNode(child, state, dimension));
}

export function getPinnedSizeForNode(node, state, direction) {
  const dimension = direction === "h" ? "width" : "height";
  const sizes = getPinnedSizesForNode(node, state, dimension);
  return sizes.length > 0 ? Math.max(...sizes) : null;
}

// ---------------------------------------------------------------------------
// SplitDivider — unified resize handle between any two adjacent children
// ---------------------------------------------------------------------------

function SplitDivider({
  parentPath,
  aboveIdx,
  belowIdx,
  direction,
  aboveNode,
  belowNode,
  dividerCount,
  visibleChildIndices,
}) {
  const { state, resizeChildren } = useWorkspaceStore();
  const ref = useRef(null);
  const isH = direction === "h";

  function handleMouseDown(e) {
    e.preventDefault();
    const aboveEl = ref.current?.previousElementSibling;
    const belowEl = ref.current?.nextElementSibling;
    if (!aboveEl || !belowEl) return;

    const containerEl = ref.current.parentElement;
    const childElements = Array.from(containerEl.children).filter(
      (el) => el.hasAttribute("data-leaf") || el.hasAttribute("data-split")
    );
    const startAbovePx = isH ? aboveEl.offsetWidth : aboveEl.offsetHeight;
    const startBelowPx = isH ? belowEl.offsetWidth : belowEl.offsetHeight;
    const startChildSizesPx = visibleChildIndices.map((childIdx, renderIdx) => {
      const el = childElements[renderIdx];
      return {
        childIdx,
        sizePx: isH ? el?.offsetWidth || 0 : el?.offsetHeight || 0,
      };
    });
    const containerPx = isH ? containerEl.clientWidth : containerEl.clientHeight;
    const dividerPx = isH ? ref.current.offsetWidth : ref.current.offsetHeight;
    const contentPx = containerPx - dividerCount * dividerPx;
    if (contentPx <= 0) return;
    const startPos = isH ? e.clientX : e.clientY;
    const dimension = isH ? "minWidth" : "minHeight";
    const minAbove = getSubtreeMinSize(aboveNode, state, dimension);
    const minBelow = getSubtreeMinSize(belowNode, state, dimension);

    function onMove(ev) {
      const delta = (isH ? ev.clientX : ev.clientY) - startPos;
      const clampedDelta = Math.min(
        Math.max(delta, -(startAbovePx - minAbove)),
        startBelowPx - minBelow
      );
      resizeChildren(
        parentPath,
        aboveIdx,
        belowIdx,
        (startAbovePx + clampedDelta) / contentPx,
        (startBelowPx - clampedDelta) / contentPx,
        {
          direction,
          abovePx: startAbovePx + clampedDelta,
          belowPx: startBelowPx - clampedDelta,
          childSizesPx: startChildSizesPx.map((child) => {
            if (child.childIdx === aboveIdx) {
              return { ...child, sizePx: startAbovePx + clampedDelta };
            }
            if (child.childIdx === belowIdx) {
              return { ...child, sizePx: startBelowPx - clampedDelta };
            }
            return child;
          }),
        }
      );
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div
      ref={ref}
      className={cn(
        "shrink-0 transition-colors hover:bg-primary/20 active:bg-primary/30",
        isH ? "w-1.5 cursor-ew-resize" : "h-1.5 cursor-ns-resize"
      )}
      onMouseDown={handleMouseDown}
    />
  );
}

// ---------------------------------------------------------------------------
// SplitView — recursive tree renderer
// ---------------------------------------------------------------------------

function SplitView({ node, path, style }) {
  const { state } = useWorkspaceStore();
  const { panelsById } = state;

  if (node.type === "leaf") {
    if (isNodeEmpty(node, panelsById)) return null;
    return <LeafView node={node} path={path} style={style} />;
  }

  const isH = node.direction === "h";

  // Collect indices of non-empty children to drive correct divider placement and resize indices.
  const visibleChildIndices = node.children
    .map((child, i) => (isNodeEmpty(child, panelsById) ? null : i))
    .filter((i) => i !== null);

  const visibleSizes = visibleChildIndices.map((i) => node.sizes[i]);
  const visiblePinnedPixels = visibleChildIndices.map((i) =>
    getPinnedSizeForNode(node.children[i], state, node.direction)
  );
  const dividerCount = Math.max(0, visibleChildIndices.length - 1);
  const sizingContext = getSplitSizingContext(visibleSizes, dividerCount, visiblePinnedPixels);

  return (
    <div
      data-split
      style={style}
      className={cn("flex min-h-0 min-w-0", isH ? "flex-row" : "flex-col")}
    >
      {visibleChildIndices.map((childIdx, renderIdx) => {
        const child = node.children[childIdx];
        const size = node.sizes[childIdx];
        const pinnedPx = visiblePinnedPixels[renderIdx];
        const childStyle = getSplitChildStyle(size, sizingContext, pinnedPx);

        const aboveChildIdx = renderIdx > 0 ? visibleChildIndices[renderIdx - 1] : -1;

        return (
          <Fragment key={childIdx}>
            {renderIdx > 0 && (
              <SplitDivider
                parentPath={path}
                aboveIdx={aboveChildIdx}
                belowIdx={childIdx}
                direction={node.direction}
                aboveNode={node.children[aboveChildIdx]}
                belowNode={child}
                dividerCount={dividerCount}
                visibleChildIndices={visibleChildIndices}
              />
            )}
            <SplitView node={child} path={[...path, childIdx]} style={childStyle} />
          </Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FullscreenOverlay
// ---------------------------------------------------------------------------

function FullscreenOverlay() {
  const {
    state,
    setFullscreen,
    setPanelControlsForPanel,
    resetPanelControlsForPanel,
    setPanelPinned,
  } = useWorkspaceStore();
  const { fullscreenId } = state;
  const chromeData = usePanelChromeData();
  const def = fullscreenId ? resolvePanelDefinition(state, fullscreenId) : null;
  const Component = def?.Component ?? null;
  const fullscreenModuleId = fullscreenId ? resolvePanelModuleId(state, fullscreenId) : null;
  const helpItems = fullscreenModuleId ? PANEL_HELP_BY_MODULE_ID[fullscreenModuleId] : null;
  const panelControls = fullscreenId ? getPanelControls(state, fullscreenId) : null;
  const isPinned = Boolean(fullscreenId && state.pinnedPanelsById?.[fullscreenId]);
  const onPanelControlsChange = useCallback(
    (nextPanelControls) => {
      if (!fullscreenId) return;
      setPanelControlsForPanel(fullscreenId, nextPanelControls);
    },
    [fullscreenId, setPanelControlsForPanel]
  );
  const onPanelControlsReset = useCallback(() => {
    if (!fullscreenId) return;
    resetPanelControlsForPanel(fullscreenId);
  }, [fullscreenId, resetPanelControlsForPanel]);
  const panelInstanceData = useMemo(
    () => ({
      panelControls,
      onPanelControlsChange: fullscreenId ? onPanelControlsChange : undefined,
      analysisStatus: chromeData?.analysisStatusByPanelId?.[fullscreenId],
      panelVisible: true,
    }),
    [chromeData?.analysisStatusByPanelId, fullscreenId, onPanelControlsChange, panelControls]
  );

  if (!fullscreenId || !def || !Component) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col"
      style={{
        backgroundColor: "color-mix(in srgb, var(--background) var(--panel-opacity), transparent)",
      }}
      onKeyDown={(e) => e.key === "Escape" && setFullscreen(null)}
      tabIndex={-1}
    >
      <div className={PANEL_HEADER_BAR}>
        <PanelTitleGroup icon={def.Icon} title={resolvePanelDisplayName(state, fullscreenId)} />
        <div className={PANEL_HEADER_ACTIONS}>
          <PanelSettingsMenu
            activeTab={fullscreenModuleId}
            panelTitle={resolvePanelDisplayName(state, fullscreenId)}
            channelCount={chromeData?.channelCount ?? 0}
            vectorscopeOptions={chromeData?.vectorscopePairOptions ?? []}
            vectorscopeValueKey={chromeData?.vectorscopeValueKey ?? ""}
            vectorscopeDisplayLabel={chromeData?.vectorscopeDisplayLabel ?? ""}
            onVectorscopeChange={noop}
            spectrumOptions={chromeData?.spectrumChannelOptions ?? []}
            spectrumValueKey={chromeData?.spectrumValueKey ?? ""}
            spectrumDisplayLabel={chromeData?.spectrumDisplayLabel ?? ""}
            onSpectrumChange={noop}
            spectrumView={chromeData?.spectrumView ?? "combined"}
            spectrumViewLegend={chromeData?.spectrumViewLegend ?? null}
            onSpectrumViewChange={noop}
            spectrumMaxHold={chromeData?.spectrumMaxHold ?? false}
            onSpectrumMaxHoldToggle={noop}
            panelControls={panelControls}
            onPanelControlsChange={onPanelControlsChange}
            onPanelControlsReset={onPanelControlsReset}
          />
          {helpItems ? <HelpPopover items={helpItems} /> : null}
          <HoverTip
            tip={isPinned ? "Unpin panel size" : "Exit fullscreen to pin the current panel size"}
          >
            <button
              type="button"
              className={cn(PANEL_HEADER_ACTION_BUTTON, isPinned && "text-primary opacity-100")}
              onClick={() => isPinned && setPanelPinned(fullscreenId, null)}
              aria-label={
                isPinned ? "Unpin panel size" : "Panel size pin unavailable in fullscreen"
              }
              aria-pressed={isPinned}
              disabled={!isPinned}
            >
              <Pin size={12} fill={isPinned ? "currentColor" : "none"} />
            </button>
          </HoverTip>
          <button
            type="button"
            className={PANEL_HEADER_ACTION_BUTTON}
            onClick={() => setFullscreen(null)}
            aria-label="Exit fullscreen"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <PanelInstanceProvider value={panelInstanceData}>
          <Component compact={chromeData?.compactPanels === true} />
        </PanelInstanceProvider>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SplitContent — root layout component
// ---------------------------------------------------------------------------

function SplitContent() {
  const { state, moveTab, setFullscreen } = useWorkspaceStore();
  const { tree } = state;

  const onDrop = useCallback((sourceId, drop) => moveTab(sourceId, drop), [moveTab]);

  // Stable ref for keyboard shortcuts (registered once)
  const shortcutRef = useRef(null);
  shortcutRef.current = { state, setFullscreen };

  useEffect(() => {
    function onKeyDown(e) {
      if (e.target.matches('input, textarea, select, [contenteditable="true"]')) return;
      const { state: s, setFullscreen: full } = shortcutRef.current;

      if (e.key === "Escape" && s.fullscreenId) {
        full(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <DragProvider onDrop={onDrop}>
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        {tree ? (
          <SplitView
            node={tree}
            path={[]}
            style={{
              flex: "1 1 0",
              minWidth: 0,
              minHeight: 0,
              visibility: state.fullscreenId ? "hidden" : undefined,
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[length:var(--ui-fs-body)] text-muted-foreground">
            No panels
          </div>
        )}
        <FullscreenOverlay />
      </main>
    </DragProvider>
  );
}

export const SplitLayout = memo(function SplitLayout() {
  return <SplitContent />;
});
