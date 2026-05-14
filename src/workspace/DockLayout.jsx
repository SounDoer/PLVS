import { Fragment, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from './WorkspaceContext.jsx';
import { DragProvider, useDrag } from './DragContext.jsx';
import { DockSlot } from './DockSlot.jsx';
import { MODULE_REGISTRY } from './registry.jsx';
import { ALL_MODULE_IDS } from './constants.js';

// ---------------------------------------------------------------------------
// Resizable divider between regions
// ---------------------------------------------------------------------------

/**
 * @param {{ regionKey: 'left'|'right'|'bottom', orientation: 'vertical'|'horizontal' }} props
 */
function DockDivider({ regionKey, orientation }) {
  const { state, setRegionSize } = useWorkspaceStore();
  const mainRef = useRef(null);

  function handleMouseDown(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startSize = state.dock.regions[regionKey].size ?? 0;

    function onMove(ev) {
      const main = mainRef.current?.closest('main');
      const containerW = main?.clientWidth ?? 800;
      const containerH = main?.clientHeight ?? 600;

      let delta, min, max;
      if (orientation === 'vertical') {
        delta = ev.clientX - startX;
        // right divider: moving right → shrinks right region → sign = -1
        if (regionKey === 'right') delta = -delta;
        min = 160;
        max = containerW * 0.45;
      } else {
        // bottom divider: moving down → shrinks bottom → sign = -1
        delta = -(ev.clientY - startY);
        min = 100;
        max = containerH * 0.65;
      }
      setRegionSize(regionKey, Math.max(min, Math.min(max, startSize + delta)));
    }

    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div
      ref={mainRef}
      className={cn(
        'shrink-0 transition-colors hover:bg-primary/20 active:bg-primary/30',
        orientation === 'vertical' ? 'w-1.5 cursor-ew-resize' : 'h-1.5 cursor-ns-resize'
      )}
      onMouseDown={handleMouseDown}
    />
  );
}

// ---------------------------------------------------------------------------
// Resizable divider between slots within a region
// ---------------------------------------------------------------------------

function SlotDivider({ regionKey, aboveIdx, belowIdx, regionIsHorizontal }) {
  const { setSlotSize } = useWorkspaceStore();
  const ref = useRef(null);

  function handleMouseDown(e) {
    e.preventDefault();
    const aboveEl = ref.current?.previousElementSibling;
    const belowEl = ref.current?.nextElementSibling;
    if (!aboveEl || !belowEl) return;

    const startAbove = regionIsHorizontal ? aboveEl.clientWidth : aboveEl.clientHeight;
    const startBelow = regionIsHorizontal ? belowEl.clientWidth : belowEl.clientHeight;
    const startPos = regionIsHorizontal ? e.clientX : e.clientY;
    const MIN = 80;

    function onMove(ev) {
      const delta = (regionIsHorizontal ? ev.clientX : ev.clientY) - startPos;
      setSlotSize(regionKey, aboveIdx, Math.max(MIN, startAbove + delta));
      setSlotSize(regionKey, belowIdx, Math.max(MIN, startBelow - delta));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  return (
    <div
      ref={ref}
      className={cn(
        'shrink-0 transition-colors hover:bg-primary/20 active:bg-primary/30',
        regionIsHorizontal ? 'w-1.5 cursor-ew-resize' : 'h-1.5 cursor-ns-resize'
      )}
      onMouseDown={handleMouseDown}
    />
  );
}

// ---------------------------------------------------------------------------
// Dock Region
// ---------------------------------------------------------------------------

function DockRegion({ regionKey, forceVisible = false }) {
  const { state } = useWorkspaceStore();
  const { dragState, hoverDrop } = useDrag();
  const { dock, visibleModules } = state;
  const region = dock.regions[regionKey];
  const isDragging = !!dragState;
  const isDropTarget = hoverDrop?.targetRegion === regionKey && hoverDrop?.zone === 'empty-region';

  const isHorizontal = regionKey === 'bottom';
  const sizeStyle =
    regionKey === 'left' || regionKey === 'right'
      ? { width: region.size ?? 0 }
      : regionKey === 'bottom'
      ? { height: region.size ?? 0 }
      : {};

  const visibleSlots = region.slots
    .map((slot, i) => ({ slot, originalIndex: i }))
    .filter(({ slot }) => slot.tabs.some((id) => visibleModules.includes(id)));

  const isEmpty = visibleSlots.length === 0;
  const hasNoSize = !region.size || region.size === 0;

  // Non-center regions with no content: hidden normally, revealed while dragging
  if (regionKey !== 'center' && hasNoSize && isEmpty && !isDragging && !forceVisible) {
    return null;
  }

  return (
    <div
      data-region={regionKey}
      className={cn(
        'flex min-h-0 min-w-0',
        isHorizontal ? 'flex-row' : 'flex-col',
        regionKey === 'center' && 'flex-1',
        // Show hidden side regions as a slim drop target while dragging
        regionKey !== 'center' && hasNoSize && isEmpty && isDragging && 'w-16 min-w-[4rem]'
      )}
      style={(!isEmpty || !hasNoSize) ? sizeStyle : undefined}
    >
      {isEmpty && (
        <div
          data-empty-region={regionKey}
          className={cn(
            'flex flex-1 items-center justify-center rounded-[10px] border border-dashed text-xs transition-colors',
            isDropTarget
              ? 'border-primary bg-primary/5 text-primary'
              : 'border-border/40 text-muted-foreground/40'
          )}
        >
          {isDragging ? 'Drop here' : ''}
        </div>
      )}
      {visibleSlots.map(({ slot, originalIndex }, i) => {
        const prev = i > 0 ? visibleSlots[i - 1] : null;
        const showDivider = prev && !prev.slot.collapsed && !slot.collapsed;
        const isLast = i === visibleSlots.length - 1;
        return (
          <Fragment key={originalIndex}>
            {showDivider && (
              <SlotDivider
                regionKey={regionKey}
                aboveIdx={prev.originalIndex}
                belowIdx={originalIndex}
                regionIsHorizontal={isHorizontal}
              />
            )}
            <DockSlot slot={slot} regionKey={regionKey} slotIndex={originalIndex} isLast={isLast} />
          </Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fullscreen overlay
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
      onKeyDown={(e) => e.key === 'Escape' && setFullscreen(null)}
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
          </svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Component compact={false} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DockLayout — replaces PanelSet
// ---------------------------------------------------------------------------

function DockContent() {
  const { state, moveTab, toggleModuleVisible, setFocus, setFullscreen } = useWorkspaceStore();
  const { dock } = state;
  const leftSize = dock.regions.left?.size ?? 0;
  const rightSize = dock.regions.right?.size ?? 0;
  const bottomSize = dock.regions.bottom?.size ?? 0;

  const onDrop = useCallback((sourceId, drop) => moveTab(sourceId, drop), [moveTab]);

  // Stable ref so the keydown listener is registered only once
  const shortcutRef = useRef(null);
  shortcutRef.current = { state, toggleModuleVisible, setFocus, setFullscreen };

  useEffect(() => {
    function onKeyDown(e) {
      if (e.target.matches('input, textarea, select, [contenteditable="true"]')) return;
      const { state: s, toggleModuleVisible: toggle, setFocus: focus, setFullscreen: full } = shortcutRef.current;

      const digit = parseInt(e.key, 10);
      const isDigit = digit >= 1 && digit <= 6;
      const moduleId = isDigit ? ALL_MODULE_IDS[digit - 1] : null;

      if (isDigit && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        focus(moduleId);
        return;
      }
      if (isDigit && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggle(moduleId);
        return;
      }
      if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (s.focusId) full(s.focusId);
        return;
      }
      if (e.key === 'Escape' && s.fullscreenId) {
        full(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <DragProvider onDrop={onDrop}>
      <main className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Main row: left | divider | center | divider | right */}
          <div className="flex min-h-0 flex-1">
            {/* Left region — always mount during drag so it can receive drops */}
            {(leftSize > 0) && (
              <>
                <DockRegion regionKey="left" />
                <DockDivider regionKey="left" orientation="vertical" />
              </>
            )}
            {leftSize === 0 && <DockRegion regionKey="left" />}

            <DockRegion regionKey="center" />

            {rightSize === 0 && <DockRegion regionKey="right" />}
            {rightSize > 0 && (
              <>
                <DockDivider regionKey="right" orientation="vertical" />
                <DockRegion regionKey="right" />
              </>
            )}
          </div>

          {/* Bottom region */}
          {bottomSize > 0 && (
            <>
              <DockDivider regionKey="bottom" orientation="horizontal" />
              <DockRegion regionKey="bottom" />
            </>
          )}
          {bottomSize === 0 && (
            <div className="h-0 overflow-hidden">
              <DockRegion regionKey="bottom" />
            </div>
          )}
        </div>

        <FullscreenOverlay />
      </main>
    </DragProvider>
  );
}

export function DockLayout() {
  return <DockContent />;
}
