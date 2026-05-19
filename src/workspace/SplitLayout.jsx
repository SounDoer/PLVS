import { Fragment, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";
import { DragProvider, useDrag } from "./DragContext.jsx";
import { LeafView } from "./LeafView.jsx";
import { MODULE_REGISTRY } from "./registry.jsx";
import { ALL_MODULE_IDS } from "./constants.js";

// ---------------------------------------------------------------------------
// Min-size helper for a subtree
// ---------------------------------------------------------------------------

function getSubtreeMinSize(node, visibleModules, dimension) {
  if (node.type === "leaf") {
    const mins = node.tabs
      .filter((id) => visibleModules.includes(id))
      .map((id) => MODULE_REGISTRY[id]?.[dimension] ?? 80);
    return mins.length > 0 ? Math.max(80, ...mins) : 80;
  }
  const childMins = node.children.map((c) => getSubtreeMinSize(c, visibleModules, dimension));
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

function SplitDivider({ parentPath, aboveIdx, direction, aboveNode, belowNode }) {
  const { state, resizeChildren } = useWorkspaceStore();
  const ref = useRef(null);
  const isH = direction === "h";

  function handleMouseDown(e) {
    e.preventDefault();
    const aboveEl = ref.current?.previousElementSibling;
    const belowEl = ref.current?.nextElementSibling;
    if (!aboveEl || !belowEl) return;

    const startAbove = isH ? aboveEl.clientWidth : aboveEl.clientHeight;
    const startBelow = isH ? belowEl.clientWidth : belowEl.clientHeight;
    const startPos = isH ? e.clientX : e.clientY;
    const dimension = isH ? "minWidth" : "minHeight";
    const { visibleModules } = state;

    const minAbove = getSubtreeMinSize(aboveNode, visibleModules, dimension);
    const minBelow = getSubtreeMinSize(belowNode, visibleModules, dimension);

    function onMove(ev) {
      const delta = (isH ? ev.clientX : ev.clientY) - startPos;
      const clampedDelta = Math.min(
        Math.max(delta, -(startAbove - minAbove)),
        startBelow - minBelow
      );
      resizeChildren(parentPath, aboveIdx, startAbove + clampedDelta, startBelow - clampedDelta);
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
  if (node.type === "leaf") {
    return <LeafView node={node} path={path} style={style} />;
  }

  const isH = node.direction === "h";

  return (
    <div style={style} className={cn("flex min-h-0 min-w-0", isH ? "flex-row" : "flex-col")}>
      {node.children.map((child, i) => {
        const size = node.sizes[i];
        const childStyle =
          size > 0
            ? { flex: `0 0 ${size}px`, minWidth: 0, minHeight: 0 }
            : { flex: "1 1 0", minWidth: 0, minHeight: 0 };

        return (
          <Fragment key={i}>
            {i > 0 && (
              <SplitDivider
                parentPath={path}
                aboveIdx={i - 1}
                direction={node.direction}
                aboveNode={node.children[i - 1]}
                belowNode={child}
              />
            )}
            <SplitView node={child} path={[...path, i]} style={childStyle} />
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
  const { state, moveTab, setFullscreen, scaleSizes } = useWorkspaceStore();
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
      const isDigit = digit >= 1 && digit <= 6;

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

  // Scale stored pixel sizes proportionally when the layout container is resized
  const mainRef = useRef(null);
  const prevContainerSizeRef = useRef(null);
  const scaleSizesRef = useRef(scaleSizes);
  scaleSizesRef.current = scaleSizes;

  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const prev = prevContainerSizeRef.current;
        if (prev && prev.width > 0 && prev.height > 0) {
          const scaleX = width / prev.width;
          const scaleY = height / prev.height;
          if (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
            scaleSizesRef.current(scaleX, scaleY);
          }
        }
        prevContainerSizeRef.current = { width, height };
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <DragProvider onDrop={onDrop}>
      <main ref={mainRef} className="relative flex min-h-0 flex-1 overflow-hidden">
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
