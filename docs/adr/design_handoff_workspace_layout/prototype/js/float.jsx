// ====================================================================
// FREE FLOAT LAYOUT
// Modules as freely-positioned windows. Drag header to move, corner
// handles to resize. Z-order tracks focus. Smart "tile" arrange action.
// ====================================================================

const FLOAT_DEFAULT = {
  loudness:      { x: 280, y: 20,  w: 720, h: 320, z: 5 },
  loudnessStats: { x: 1010, y: 20, w: 260, h: 320, z: 4 },
  peak:          { x: 20,  y: 20,  w: 250, h: 380, z: 3 },
  vectorscope:   { x: 20,  y: 410, w: 250, h: 280, z: 2 },
  spectrum:    { x: 280, y: 350, w: 720, h: 220, z: 1 },
  spectrogram: { x: 280, y: 580, w: 990, h: 160, z: 0 },
};

function FloatLayout({
  visibleIds,
  hiddenIds,
  floatState,
  setFloatState,
  focusId,
  setFocusId,
  fullscreenId,
  setFullscreenId,
  collapsedIds,
  toggleCollapse,
  onClose,
  onShow,
  onTile,
}) {
  const containerRef = React.useRef(null);
  const containerSize = useSizeOf(containerRef);
  const dragRef = React.useRef(null);

  // Bring focused window to top z-index
  const bringToFront = (id) => {
    setFloatState((prev) => {
      const maxZ = Math.max(...Object.values(prev).map((v) => v.z || 0));
      if (prev[id].z === maxZ) return prev;
      return { ...prev, [id]: { ...prev[id], z: maxZ + 1 } };
    });
  };

  const startMove = (id) => (e) => {
    bringToFront(id);
    setFocusId(id);
    const pos = floatState[id];
    if (!pos) return;
    const sx = e.clientX, sy = e.clientY;
    const ox = pos.x, oy = pos.y;
    dragRef.current = { id, mode: "move" };
    const onMove = (ev) => {
      const nx = Math.max(0, Math.min(containerSize.w - 80, ox + ev.clientX - sx));
      const ny = Math.max(0, Math.min(containerSize.h - 30, oy + ev.clientY - sy));
      setFloatState((prev) => ({ ...prev, [id]: { ...prev[id], x: nx, y: ny } }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startResize = (id) => (side, e) => {
    bringToFront(id);
    setFocusId(id);
    const pos = floatState[id];
    if (!pos) return;
    const sx = e.clientX, sy = e.clientY;
    const reg = MODULE_REGISTRY[id];
    dragRef.current = { id, mode: "resize" };
    const onMove = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      let nw = pos.w, nh = pos.h;
      if (side.includes("e")) nw = Math.max(reg.minW || 160, pos.w + dx);
      if (side.includes("s")) nh = Math.max(reg.minH || 120, pos.h + dy);
      nw = Math.min(containerSize.w - pos.x - 4, nw);
      nh = Math.min(containerSize.h - pos.y - 4, nh);
      setFloatState((prev) => ({ ...prev, [id]: { ...prev[id], w: nw, h: nh } }));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="float" ref={containerRef}>
      {/* Subtle dot grid */}
      <div className="float-grid"></div>

      {visibleIds.map((id) => {
        const pos = floatState[id];
        if (!pos) return null;
        const reg = MODULE_REGISTRY[id];
        const isCompactLufs = id === "loudnessStats" && pos.w < 260;
        return (
          <Module
            key={id}
            id={id}
            title={reg.title}
            focus={focusId === id}
            collapsed={collapsedIds.has(id)}
            draggable
            resizable={collapsedIds.has(id) ? null : ["e", "s", "se"]}
            onClose={() => onClose(id)}
            onCollapse={() => toggleCollapse(id)}
            onFullscreen={() => setFullscreenId(id)}
            onFocus={() => { bringToFront(id); setFocusId(id); }}
            onDragStart={startMove(id)}
            onResizeStart={startResize(id)}
            showGrip
            style={{
              position: "absolute",
              left: pos.x, top: pos.y,
              width: pos.w, height: collapsedIds.has(id) ? "auto" : pos.h,
              zIndex: pos.z,
              boxShadow: focusId === id
                ? "0 12px 32px rgba(0,0,0,0.55), 0 0 0 1px var(--accent)"
                : "var(--shadow-2)",
            }}
          >
            {reg.render(isCompactLufs)}
          </Module>
        );
      })}

      {hiddenIds.length > 0 && (
        <div className="hidden-tray">
          {hiddenIds.map((id) => (
            <button key={id} className="hidden-chip" onClick={() => onShow(id)}>
              {MODULE_REGISTRY[id].title}
            </button>
          ))}
        </div>
      )}

      <div className="float-help">
        <span>Drag header to move</span>
        <span>·</span>
        <span>Drag corner to resize</span>
        <span>·</span>
        <span>Click "Arrange" to auto-tile</span>
      </div>
    </div>
  );
}

// Tile layout helper: arrange visible modules in a tidy grid
function tileFloat(visibleIds, containerW, containerH) {
  // Use a specific "broadcast" preset for known modules
  const W = containerW - 20, H = containerH - 20;
  const result = {};
  // Sidebar
  if (visibleIds.includes("peak")) result.peak = { x: 10, y: 10, w: 240, h: H * 0.55, z: 1 };
  if (visibleIds.includes("vectorscope")) result.vectorscope = { x: 10, y: 10 + H * 0.55 + 10, w: 240, h: H * 0.45 - 10, z: 1 };
  const sideOff = visibleIds.includes("peak") || visibleIds.includes("vectorscope") ? 260 : 10;
  // Right Loudness Stats
  const rightW = 240;
  const rightOff = visibleIds.includes("loudnessStats") ? rightW + 10 : 0;
  if (visibleIds.includes("loudnessStats")) result.loudnessStats = { x: containerW - rightW - 10, y: 10, w: rightW, h: H * 0.55, z: 1 };
  // Center top: loudness
  const centerW = W - sideOff - rightOff;
  if (visibleIds.includes("loudness")) result.loudness = { x: sideOff, y: 10, w: centerW, h: H * 0.45, z: 1 };
  // Center mid: spectrum
  if (visibleIds.includes("spectrum")) result.spectrum = { x: sideOff, y: 10 + H * 0.45 + 10, w: centerW + rightOff, h: H * 0.25 - 10, z: 1 };
  // Bottom: spectrogram
  if (visibleIds.includes("spectrogram")) result.spectrogram = { x: sideOff, y: 10 + H * 0.7, w: W - sideOff + 10, h: H * 0.3 - 10, z: 1 };
  // Fill defaults for any missing
  for (const id of visibleIds) {
    if (!result[id]) result[id] = FLOAT_DEFAULT[id];
  }
  return result;
}

Object.assign(window, { FloatLayout, FLOAT_DEFAULT, tileFloat });
