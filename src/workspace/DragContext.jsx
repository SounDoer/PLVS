import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { resolvePanelDisplayName } from "./panelInstances.js";
import { useWorkspaceStore } from "./WorkspaceContext.jsx";

export const DragContext = createContext(null);

/**
 * Compute drop target from mouse position using elementsFromPoint.
 * Returns { targetPath, zone, tabIndex? } or null.
 */
function computeDropTarget(x, y) {
  const elements = document.elementsFromPoint(x, y);

  const leafEl = elements.find((el) => el.hasAttribute("data-leaf"));
  if (leafEl) {
    const targetPath = JSON.parse(leafEl.dataset.leafPath ?? "[]");

    const tabsEl = leafEl.querySelector("[data-leaf-tabs]");
    const bodyEl = leafEl.querySelector("[data-leaf-body]");

    if (tabsEl) {
      const tabsRect = tabsEl.getBoundingClientRect();
      if (y >= tabsRect.top && y <= tabsRect.bottom) {
        const pills = Array.from(tabsEl.querySelectorAll("[data-tab-pill]"));
        let tabIndex = pills.length;
        for (let i = 0; i < pills.length; i++) {
          const rect = pills[i].getBoundingClientRect();
          if (x < rect.left + rect.width / 2) {
            tabIndex = i;
            break;
          }
        }
        return { targetPath, zone: "tabs", tabIndex };
      }
    }

    if (bodyEl) {
      const r = bodyEl.getBoundingClientRect();
      const relX = x - r.left;
      const relY = y - r.top;
      const w = r.width;
      const h = r.height;

      // Edge thresholds: 20% from each side
      const edgeX = w * 0.2;
      const edgeY = h * 0.2;

      if (relX < edgeX) return { targetPath, zone: "left" };
      if (relX > w - edgeX) return { targetPath, zone: "right" };
      if (relY < edgeY) return { targetPath, zone: "above" };
      if (relY > h - edgeY) return { targetPath, zone: "below" };

      // Center region: find closest edge
      const distLeft = relX;
      const distRight = w - relX;
      const distTop = relY;
      const distBottom = h - relY;
      const minDist = Math.min(distLeft, distRight, distTop, distBottom);
      if (minDist === distLeft) return { targetPath, zone: "left" };
      if (minDist === distRight) return { targetPath, zone: "right" };
      if (minDist === distTop) return { targetPath, zone: "above" };
      return { targetPath, zone: "below" };
    }

    return { targetPath, zone: "below" };
  }

  return null;
}

export function DragProvider({ children, onDrop }) {
  const { state } = useWorkspaceStore();
  const [dragState, setDragState] = useState(null); // { sourceId, x, y }
  const [hoverDrop, setHoverDrop] = useState(null);

  const startRef = useRef(null);
  const activeRef = useRef(false);
  const hoverDropRef = useRef(null);

  const onTabMouseDown = useCallback((e, tabId) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, y: e.clientY, tabId };
    activeRef.current = false;
  }, []);

  useEffect(() => {
    function onMove(e) {
      if (!startRef.current) return;
      if (!activeRef.current) {
        const dx = e.clientX - startRef.current.x;
        const dy = e.clientY - startRef.current.y;
        if (Math.hypot(dx, dy) < 4) return;
        activeRef.current = true;
        setDragState({ sourceId: startRef.current.tabId, x: e.clientX, y: e.clientY });
      } else {
        setDragState((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
        const drop = computeDropTarget(e.clientX, e.clientY);
        hoverDropRef.current = drop;
        setHoverDrop(drop);
      }
    }

    function onUp() {
      if (activeRef.current && hoverDropRef.current && startRef.current) {
        onDrop(startRef.current.tabId, hoverDropRef.current);
      }
      startRef.current = null;
      activeRef.current = false;
      hoverDropRef.current = null;
      setDragState(null);
      setHoverDrop(null);
    }

    function onKey(e) {
      if (e.key === "Escape" && activeRef.current) {
        startRef.current = null;
        activeRef.current = false;
        hoverDropRef.current = null;
        setDragState(null);
        setHoverDrop(null);
      }
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [onDrop]);

  return (
    <DragContext.Provider value={{ dragState, hoverDrop, onTabMouseDown }}>
      {children}
      {dragState && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-primary/60 bg-card px-2 py-0.5 text-[length:var(--ui-fs-control)] font-medium shadow-lg"
          style={{ left: dragState.x + 14, top: dragState.y - 8 }}
        >
          {resolvePanelDisplayName(state, dragState.sourceId)}
        </div>
      )}
    </DragContext.Provider>
  );
}

export function useDrag() {
  return useContext(DragContext);
}
