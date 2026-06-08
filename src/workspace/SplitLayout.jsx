import { Fragment, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { DragProvider, useDrag } from "./DragContext.jsx";
import { LeafView } from "./LeafView.jsx";
import { MODULE_REGISTRY } from "./registry.jsx";
import { ALL_MODULE_IDS } from "./constants.js";

// ---------------------------------------------------------------------------
// Empty-node helper and min-size helper for a subtree
// ---------------------------------------------------------------------------

function isNodeEmpty(node, visibleModules) {
  if (node.type === "leaf") {
    return !node.tabs.some((id) => visibleModules.includes(id));
  }
  return node.children.every((c) => isNodeEmpty(c, visibleModules));
}

function getSubtreeMinSize(node, visibleModules, dimension) {
  if (node.type === "leaf") {
    const mins = node.tabs
      .filter((id) => visibleModules.includes(id))
      .map((id) => MODULE_REGISTRY[id]?.[dimension] ?? 80);
    return mins.length > 0 ? Math.max(80, ...mins) : 0;
  }
  const childMins = node.children
    .filter((c) => !isNodeEmpty(c, visibleModules))
    .map((c) => getSubtreeMinSize(c, visibleModules, dimension));
  if (childMins.length === 0) return 0;
  const isAdditive =
    (dimension === "minWidth" && node.direction === "h") ||
    (dimension === "minHeight" && node.direction === "v");
  return isAdditive
    ? Math.max(
        80,
        childMins.reduce((a, b) => a + b, 0)
      )
    : Math.max(80, ...childMins);
}

// ---------------------------------------------------------------------------
// SplitDivider — unified resize handle between any two adjacent children
// ---------------------------------------------------------------------------

function SplitDivider({ parentPath, aboveIdx, belowIdx, direction, aboveNode, belowNode }) {
  const { state, resizeChildren } = useWorkspaceStore();
  const ref = useRef(null);
  const isH = direction === "h";

  function handleMouseDown(e) {
    e.preventDefault();
    const aboveEl = ref.current?.previousElementSibling;
    const belowEl = ref.current?.nextElementSibling;
    if (!aboveEl || !belowEl) return;

    const containerEl = ref.current.parentElement;
    const startAbovePx = isH ? aboveEl.offsetWidth : aboveEl.offsetHeight;
    const startBelowPx = isH ? belowEl.offsetWidth : belowEl.offsetHeight;
    const containerPx = isH ? containerEl.clientWidth : containerEl.clientHeight;
    if (containerPx === 0) return;
    const startPos = isH ? e.clientX : e.clientY;
    const dimension = isH ? "minWidth" : "minHeight";
    const { visibleModules } = state;

    const minAbove = getSubtreeMinSize(aboveNode, visibleModules, dimension);
    const minBelow = getSubtreeMinSize(belowNode, visibleModules, dimension);

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
        (startAbovePx + clampedDelta) / containerPx,
        (startBelowPx - clampedDelta) / containerPx
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
  const { visibleModules } = state;

  if (node.type === "leaf") {
    if (isNodeEmpty(node, visibleModules)) return null;
    return <LeafView node={node} path={path} style={style} />;
  }

  const isH = node.direction === "h";

  // Collect indices of non-empty children to drive correct divider placement and resize indices.
  const visibleChildIndices = node.children
    .map((child, i) => (isNodeEmpty(child, visibleModules) ? null : i))
    .filter((i) => i !== null);

  // When all visible children have fixed sizes (no null), normalize so they fill the container.
  const visibleSizes = visibleChildIndices.map((i) => node.sizes[i]);
  const hasNullSize = visibleSizes.some((s) => s === null);
  const fixedTotal = hasNullSize ? 1 : visibleSizes.reduce((sum, s) => sum + (s ?? 0), 0);
  const normFactor = !hasNullSize && fixedTotal > 0 ? 1 / fixedTotal : 1;

  return (
    <div style={style} className={cn("flex min-h-0 min-w-0", isH ? "flex-row" : "flex-col")}>
      {visibleChildIndices.map((childIdx, renderIdx) => {
        const child = node.children[childIdx];
        const size = node.sizes[childIdx];
        const childStyle =
          size !== null
            ? { flex: `0 0 ${size * normFactor * 100}%`, minWidth: 0, minHeight: 0 }
            : { flex: "1 1 0", minWidth: 0, minHeight: 0 };

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
  const { state, setFullscreen } = useWorkspaceStore();
  const { fullscreenId } = state;
  if (!fullscreenId) return null;

  const def = MODULE_REGISTRY[fullscreenId];
  if (!def) return null;
  const { Component } = def;

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col bg-background"
      onKeyDown={(e) => e.key === "Escape" && setFullscreen(null)}
      tabIndex={-1}
    >
      <div className="flex h-9 shrink-0 items-center border-b border-border/60 bg-card px-3 text-sm font-medium">
        {def.title}
        <button
          type="button"
          className="ml-auto rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none"
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
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Component />
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

      const digit = parseInt(e.key, 10);
      const isDigit = digit >= 1 && digit <= ALL_MODULE_IDS.length;

      if (isDigit && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        const moduleId = ALL_MODULE_IDS[digit - 1];
        full(s.fullscreenId === moduleId ? null : moduleId);
        return;
      }
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
          <SplitView node={tree} path={[]} style={{ flex: "1 1 0", minWidth: 0, minHeight: 0 }} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            No panels
          </div>
        )}
        <FullscreenOverlay />
      </main>
    </DragProvider>
  );
}

export function SplitLayout() {
  return <SplitContent />;
}
