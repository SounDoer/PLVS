import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { MODULE_REGISTRY } from './registry.jsx';

export const DragContext = createContext(null);

/** Compute drop target from mouse position using elementsFromPoint. */
function computeDropTarget(x, y) {
  const elements = document.elementsFromPoint(x, y);

  // Find nearest slot element
  const slotEl = elements.find((el) => el.hasAttribute('data-slot'));
  if (slotEl) {
    const regionKey = slotEl.dataset.region;
    const slotIndex = parseInt(slotEl.dataset.slotIndex, 10);

    const tabsEl = slotEl.querySelector('[data-slot-tabs]');
    const bodyEl = slotEl.querySelector('[data-slot-body]');

    if (tabsEl) {
      const tabsRect = tabsEl.getBoundingClientRect();
      if (y >= tabsRect.top && y <= tabsRect.bottom) {
        const pills = Array.from(tabsEl.querySelectorAll('[data-tab-pill]'));
        let tabIndex = pills.length;
        for (let i = 0; i < pills.length; i++) {
          const rect = pills[i].getBoundingClientRect();
          if (x < rect.left + rect.width / 2) {
            tabIndex = i;
            break;
          }
        }
        return { targetRegion: regionKey, slotIndex, zone: 'tabs', tabIndex };
      }
    }

    if (bodyEl) {
      const bodyRect = bodyEl.getBoundingClientRect();
      const mid = bodyRect.top + bodyRect.height / 2;
      return { targetRegion: regionKey, slotIndex, zone: y < mid ? 'above' : 'below' };
    }

    return { targetRegion: regionKey, slotIndex, zone: 'below' };
  }

  // Find empty region placeholder
  const emptyEl = elements.find((el) => el.hasAttribute('data-empty-region'));
  if (emptyEl) {
    return { targetRegion: emptyEl.dataset.emptyRegion, slotIndex: 0, zone: 'empty-region' };
  }

  return null;
}

export function DragProvider({ children, onDrop }) {
  const [dragState, setDragState] = useState(null); // { sourceId, x, y }
  const [hoverDrop, setHoverDrop] = useState(null);

  const startRef = useRef(null); // { x, y, tabId }
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
      if (e.key === 'Escape' && activeRef.current) {
        startRef.current = null;
        activeRef.current = false;
        hoverDropRef.current = null;
        setDragState(null);
        setHoverDrop(null);
      }
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [onDrop]);

  return (
    <DragContext.Provider value={{ dragState, hoverDrop, onTabMouseDown }}>
      {children}
      {/* Ghost label follows the cursor */}
      {dragState && (
        <div
          className="pointer-events-none fixed z-50 rounded border border-primary/60 bg-card px-2 py-0.5 text-xs font-medium shadow-lg"
          style={{ left: dragState.x + 14, top: dragState.y - 8 }}
        >
          {MODULE_REGISTRY[dragState.sourceId]?.title}
        </div>
      )}
    </DragContext.Provider>
  );
}

export function useDrag() {
  return useContext(DragContext);
}
