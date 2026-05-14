// ====================================================================
// DOCK + TABS LAYOUT (v2)
// Model:
//   regions: { left|center|right|bottom: { size, slots: [Slot] } }
//   Slot:    { tabs: [moduleId, ...], activeTab: id, collapsed: bool }
// Each slot is a tabbed panel area. Slots stack vertically inside a region.
// Drag a tab to: another tab bar (merge), above/below body (split), or empty region.
// ====================================================================

const DOCK_DEFAULT = {
  regions: {
    left: {
      size: 220,
      slots: [
        { tabs: ["peak"], activeTab: "peak", collapsed: false },
        { tabs: ["vectorscope"], activeTab: "vectorscope", collapsed: false },
      ],
    },
    center: {
      slots: [
        { tabs: ["loudness"], activeTab: "loudness", collapsed: false },
        { tabs: ["spectrum", "spectrogram"], activeTab: "spectrum", collapsed: false },
      ],
    },
    right: {
      size: 260,
      slots: [
        { tabs: ["loudnessStats"], activeTab: "loudnessStats", collapsed: false },
      ],
    },
    bottom: { size: 0, slots: [] },
  },
};

// ---------- Pure helpers for slot/region manipulation ----------

const cloneDockState = (s) => JSON.parse(JSON.stringify(s));

// Remove a tab id from anywhere in dockState; returns new dockState.
// Also removes the host slot if it became empty.
function removeTabFromDock(state, id) {
  const next = cloneDockState(state);
  for (const rk of Object.keys(next.regions)) {
    const r = next.regions[rk];
    for (let si = 0; si < r.slots.length; si++) {
      const slot = r.slots[si];
      const idx = slot.tabs.indexOf(id);
      if (idx >= 0) {
        slot.tabs.splice(idx, 1);
        if (slot.activeTab === id) {
          slot.activeTab = slot.tabs[Math.max(0, idx - 1)] || null;
        }
        if (slot.tabs.length === 0) {
          r.slots.splice(si, 1);
        }
        return next;
      }
    }
  }
  return next;
}

function insertTabAt(state, id, target) {
  // target: { region, slotIndex, zone: "tabs"|"above"|"below"|"empty-region", tabIndex? }
  const next = cloneDockState(state);
  const r = next.regions[target.region];
  if (target.zone === "tabs") {
    const slot = r.slots[target.slotIndex];
    const ti = target.tabIndex ?? slot.tabs.length;
    slot.tabs.splice(ti, 0, id);
    slot.activeTab = id;
  } else if (target.zone === "above") {
    r.slots.splice(target.slotIndex, 0, { tabs: [id], activeTab: id, collapsed: false });
  } else if (target.zone === "below") {
    r.slots.splice(target.slotIndex + 1, 0, { tabs: [id], activeTab: id, collapsed: false });
  } else if (target.zone === "empty-region") {
    r.slots.push({ tabs: [id], activeTab: id, collapsed: false });
    if (target.region === "bottom" && r.size < 60) r.size = 240;
    if (target.region === "left" && r.size < 60) r.size = 220;
    if (target.region === "right" && r.size < 60) r.size = 240;
  }
  return next;
}

function setActiveTabInSlot(state, region, slotIndex, tabId) {
  const next = cloneDockState(state);
  next.regions[region].slots[slotIndex].activeTab = tabId;
  return next;
}

function toggleSlotCollapsed(state, region, slotIndex) {
  const next = cloneDockState(state);
  const s = next.regions[region].slots[slotIndex];
  s.collapsed = !s.collapsed;
  return next;
}

// ---------- Tab pill ----------

function TabPill({
  id,
  active,
  showClose,
  isDragging,
  onActivate,
  onDragStart,
  onClose,
}) {
  const reg = MODULE_REGISTRY[id];
  return (
    <button
      className={"slot-tab " + (active ? "active " : "") + (isDragging ? "dragging" : "")}
      onMouseDown={(e) => {
        if (e.target.closest(".tab-close")) return;
        e.preventDefault();
        onActivate();
        onDragStart(e);
      }}
    >
      <span className="tab-dot"></span>
      <span className="tab-label">{reg.title}</span>
      {showClose && (
        <span className="tab-close" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClose(); }}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
        </span>
      )}
    </button>
  );
}

// ---------- The Slot (tabbed panel) ----------

function DockSlot({
  region,
  slotIndex,
  slot,
  visibleSet,
  focusId,
  setFocusId,
  setFullscreenId,
  onTabDragStart,
  onCloseTab,
  onCloseSlot,
  onSetActive,
  onToggleCollapse,
  dragInfo,
  hoverDrop,
}) {
  const tabs = slot.tabs.filter((id) => visibleSet.has(id));
  if (tabs.length === 0) return null;
  let activeId = tabs.includes(slot.activeTab) ? slot.activeTab : tabs[0];
  const reg = MODULE_REGISTRY[activeId];
  const slotKey = region + ":" + slotIndex;
  const isFocused = focusId === activeId;

  // Decide if drop-zone overlay is showing on this slot
  const showZones = dragInfo && hoverDrop && hoverDrop.region === region && hoverDrop.slotIndex === slotIndex;

  const isCompactLufs = activeId === "loudnessStats" && region !== "center";

  return (
    <div
      className={"dock-slot " + (isFocused ? "focused " : "") + (slot.collapsed ? "collapsed " : "")}
      data-slot
      data-region={region}
      data-slot-index={slotIndex}
      onMouseDown={() => setFocusId(activeId)}
    >
      <div className="slot-header" data-slot-tabs>
        <div className="slot-tabs">
          {tabs.map((id) => (
            <TabPill
              key={id}
              id={id}
              active={id === activeId}
              showClose={tabs.length > 1}
              isDragging={dragInfo && dragInfo.id === id}
              onActivate={() => onSetActive(region, slotIndex, id)}
              onDragStart={(e) => onTabDragStart(id, region, slotIndex)(e)}
              onClose={() => onCloseTab(id)}
            />
          ))}
        </div>
        <div className="slot-actions">
          <button title={slot.collapsed ? "Expand" : "Collapse"} onClick={(e) => { e.stopPropagation(); onToggleCollapse(region, slotIndex); }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              {slot.collapsed
                ? <path d="M3 6h6M6 3v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                : <path d="M3 6h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
            </svg>
          </button>
          <button title="Fullscreen active tab" onClick={(e) => { e.stopPropagation(); setFullscreenId(activeId); }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 4V2h2M10 4V2H8M2 8v2h2M10 8v2H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="close" title="Close slot" onClick={(e) => { e.stopPropagation(); onCloseSlot(region, slotIndex); }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {!slot.collapsed && (
        <div className="slot-body" data-slot-body>
          {reg.render(isCompactLufs)}

          {/* Drop zone overlay */}
          {showZones && (
            <div className="slot-zones">
              <div className={"zone zone-above " + (hoverDrop.zone === "above" ? "active" : "")}>
                <span className="zone-label">Insert above</span>
              </div>
              <div className={"zone zone-below " + (hoverDrop.zone === "below" ? "active" : "")}>
                <span className="zone-label">Insert below</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab-bar drop zone (merge) — visible during drag, sits over the tab bar */}
      {showZones && hoverDrop.zone === "tabs" && (
        <div className="zone-tabs-overlay"></div>
      )}
    </div>
  );
}

// ---------- The Layout ----------

function DockLayout({
  visibleIds,
  hiddenIds,
  dockState,
  setDockState,
  focusId,
  setFocusId,
  fullscreenId,
  setFullscreenId,
  onClose,
  onShow,
}) {
  const containerRef = React.useRef(null);
  const containerSize = useSizeOf(containerRef);
  const [dragInfo, setDragInfo] = React.useState(null);
  const [hoverDrop, setHoverDrop] = React.useState(null);

  const visibleSet = new Set(visibleIds);

  // ---- region divider drag ----
  const dragDivider = (which) => (e) => {
    const startSize = dockState.regions[which].size;
    const sx = e.clientX, sy = e.clientY;
    e.preventDefault();
    const onMove = (ev) => {
      let newSize;
      if (which === "left")   newSize = Math.max(160, Math.min(containerSize.w * 0.45, startSize + (ev.clientX - sx)));
      if (which === "right")  newSize = Math.max(160, Math.min(containerSize.w * 0.45, startSize - (ev.clientX - sx)));
      if (which === "bottom") newSize = Math.max(100, Math.min(containerSize.h * 0.65, startSize - (ev.clientY - sy)));
      setDockState((prev) => ({
        ...prev,
        regions: { ...prev.regions, [which]: { ...prev.regions[which], size: newSize } },
      }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ---- tab drag (move/merge/split) ----
  const onTabDragStart = (id, fromRegion, fromSlot) => (e) => {
    setDragInfo({ id, fromRegion, fromSlot, x: e.clientX, y: e.clientY });
    const onMove = (ev) => {
      setDragInfo((d) => d && { ...d, x: ev.clientX, y: ev.clientY });

      // hit-test for drop target
      const elems = document.elementsFromPoint(ev.clientX, ev.clientY);
      // Check slot
      const slotEl = elems.find((el) => el.dataset && el.dataset.slot !== undefined);
      if (slotEl) {
        const region = slotEl.dataset.region;
        const slotIndex = parseInt(slotEl.dataset.slotIndex, 10);
        // Determine which zone: tabs (over slot-header) vs above/below (body halves)
        const tabsEl = slotEl.querySelector("[data-slot-tabs]");
        const tabsRect = tabsEl?.getBoundingClientRect();
        const bodyEl = slotEl.querySelector("[data-slot-body]");
        const bodyRect = bodyEl?.getBoundingClientRect();
        if (tabsRect && ev.clientY >= tabsRect.top && ev.clientY <= tabsRect.bottom) {
          // find target tab index
          const tabPills = Array.from(tabsEl.querySelectorAll(".slot-tab"));
          let ti = tabPills.length;
          for (let i = 0; i < tabPills.length; i++) {
            const r = tabPills[i].getBoundingClientRect();
            if (ev.clientX < r.left + r.width / 2) { ti = i; break; }
          }
          setHoverDrop({ region, slotIndex, zone: "tabs", tabIndex: ti });
          return;
        }
        if (bodyRect) {
          const half = bodyRect.top + bodyRect.height / 2;
          if (ev.clientY < half) {
            setHoverDrop({ region, slotIndex, zone: "above" });
          } else {
            setHoverDrop({ region, slotIndex, zone: "below" });
          }
          return;
        }
      }
      // Empty region check
      const emptyRegionEl = elems.find((el) => el.dataset && el.dataset.emptyRegion);
      if (emptyRegionEl) {
        setHoverDrop({ region: emptyRegionEl.dataset.emptyRegion, slotIndex: -1, zone: "empty-region" });
        return;
      }
      setHoverDrop(null);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDragInfo((cur) => {
        setHoverDrop((drop) => {
          if (cur && drop) {
            // Apply drop: remove tab first, then insert
            setDockState((prev) => {
              const removed = removeTabFromDock(prev, cur.id);
              // After removal, target slotIndex may shift if source slot was removed and was earlier
              let target = { ...drop };
              if (drop.zone !== "empty-region" && drop.region === cur.fromRegion) {
                const src = prev.regions[cur.fromRegion].slots[cur.fromSlot];
                if (src && src.tabs.length === 1 && drop.slotIndex > cur.fromSlot) {
                  target.slotIndex = drop.slotIndex - 1;
                }
              }
              return insertTabAt(removed, cur.id, target);
            });
          }
          return null;
        });
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // ---- region rendering ----
  const renderRegion = (key) => {
    const region = dockState.regions[key];
    const slots = region.slots;
    const visibleSlots = slots.filter((s) => s.tabs.some((id) => visibleSet.has(id)));
    if (visibleSlots.length === 0) {
      return (
        <div className="dock-region dock-region-empty" data-empty-region={key}>
          <div className="dock-empty">
            <span>Empty {key}</span>
            <small>Drag a tab here</small>
          </div>
        </div>
      );
    }
    return (
      <div className="dock-region">
        {slots.map((slot, i) => {
          const tabsVisible = slot.tabs.filter((id) => visibleSet.has(id));
          if (tabsVisible.length === 0) return null;
          return (
            <DockSlot
              key={key + ":" + i}
              region={key}
              slotIndex={i}
              slot={slot}
              visibleSet={visibleSet}
              focusId={focusId}
              setFocusId={setFocusId}
              setFullscreenId={setFullscreenId}
              onTabDragStart={onTabDragStart}
              onCloseTab={onClose}
              onCloseSlot={(r, si) => {
                const ids = dockState.regions[r].slots[si].tabs.filter((id) => visibleSet.has(id));
                ids.forEach((id) => onClose(id));
              }}
              onSetActive={(r, si, tabId) => setDockState((prev) => setActiveTabInSlot(prev, r, si, tabId))}
              onToggleCollapse={(r, si) => setDockState((prev) => toggleSlotCollapsed(prev, r, si))}
              dragInfo={dragInfo}
              hoverDrop={hoverDrop}
            />
          );
        })}
      </div>
    );
  };

  const leftHasAny    = dockState.regions.left.slots.some((s) => s.tabs.some((id) => visibleSet.has(id)));
  const rightHasAny   = dockState.regions.right.slots.some((s) => s.tabs.some((id) => visibleSet.has(id)));
  const bottomHasAny  = dockState.regions.bottom.slots.some((s) => s.tabs.some((id) => visibleSet.has(id)));

  return (
    <div className="dock" ref={containerRef}>
      <div className="dock-top">
        {leftHasAny ? (
          <>
            <div className="dock-col" style={{ width: dockState.regions.left.size }}>
              {renderRegion("left")}
            </div>
            <div className="dock-divider dock-divider-v" onMouseDown={dragDivider("left")}></div>
          </>
        ) : dragInfo ? (
          <div className="dock-col dock-col-empty" style={{ width: 100 }}>
            {renderRegion("left")}
          </div>
        ) : null}

        <div className="dock-col dock-col-flex">{renderRegion("center")}</div>

        {rightHasAny ? (
          <>
            <div className="dock-divider dock-divider-v" onMouseDown={dragDivider("right")}></div>
            <div className="dock-col" style={{ width: dockState.regions.right.size }}>
              {renderRegion("right")}
            </div>
          </>
        ) : dragInfo ? (
          <div className="dock-col dock-col-empty" style={{ width: 100 }}>
            {renderRegion("right")}
          </div>
        ) : null}
      </div>

      {bottomHasAny ? (
        <>
          <div className="dock-divider dock-divider-h" onMouseDown={dragDivider("bottom")}></div>
          <div className="dock-bottom" style={{ height: dockState.regions.bottom.size }}>
            {renderRegion("bottom")}
          </div>
        </>
      ) : dragInfo ? (
        <div className="dock-bottom dock-bottom-empty" style={{ height: 80 }}>
          {renderRegion("bottom")}
        </div>
      ) : null}

      {hiddenIds.length > 0 && (
        <div className="hidden-tray">
          {hiddenIds.map((id) => (
            <button key={id} className="hidden-chip" onClick={() => onShow(id)}>
              {MODULE_REGISTRY[id].title}
            </button>
          ))}
        </div>
      )}

      {dragInfo && (
        <div className="dock-drag-ghost" style={{ left: dragInfo.x + 12, top: dragInfo.y + 12 }}>
          {MODULE_REGISTRY[dragInfo.id].title}
        </div>
      )}
    </div>
  );
}

Object.assign(window, {
  DockLayout, DOCK_DEFAULT,
  removeTabFromDock, insertTabAt, setActiveTabInSlot, toggleSlotCollapsed,
});
