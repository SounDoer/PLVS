// ====================================================================
// BENTO GRID LAYOUT
// Modules snap to a 12-column × 12-row grid. Drag header to move,
// drag bottom-right corner to resize. Conflicts push other modules.
// ====================================================================

const BENTO_COLS = 12;
const BENTO_ROWS = 12;

// Default bento positions (col, row, w, h on a 12×12 grid)
const BENTO_DEFAULT = {
  loudness:      { col: 0, row: 0, w: 8, h: 5 },
  loudnessStats: { col: 8, row: 0, w: 4, h: 5 },
  peak:          { col: 0, row: 5, w: 3, h: 4 },
  vectorscope:   { col: 3, row: 5, w: 3, h: 4 },
  spectrum:    { col: 6, row: 5, w: 6, h: 4 },
  spectrogram: { col: 0, row: 9, w: 12, h: 3 },
};

function rectsOverlap(a, b) {
  return !(a.col + a.w <= b.col || b.col + b.w <= a.col ||
           a.row + a.h <= b.row || b.row + b.h <= a.row);
}

function BentoLayout({
  visibleIds,
  hiddenIds,
  positions,
  setPositions,
  focusId,
  setFocusId,
  fullscreenId,
  setFullscreenId,
  collapsedIds,
  toggleCollapse,
  onClose,
  onShow,
}) {
  const containerRef = React.useRef(null);
  const containerSize = useSizeOf(containerRef);
  const [dragState, setDragState] = React.useState(null); // { id, mode, original, ghost }

  const GAP = 10;
  const cellW = containerSize.w ? (containerSize.w - GAP * (BENTO_COLS - 1)) / BENTO_COLS : 0;
  const cellH = containerSize.h ? (containerSize.h - GAP * (BENTO_ROWS - 1)) / BENTO_ROWS : 0;

  const cellToPx = (c, r) => ({
    x: c * (cellW + GAP),
    y: r * (cellH + GAP),
  });
  const sizeToPx = (w, h) => ({
    w: w * cellW + (w - 1) * GAP,
    h: h * cellH + (h - 1) * GAP,
  });

  const handleDragStart = (id) => (e) => {
    const pos = positions[id];
    if (!pos) return;
    const sx = e.clientX, sy = e.clientY;
    setDragState({ id, mode: "move", original: { ...pos }, ghost: { ...pos } });
    const onMove = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      const dCol = Math.round(dx / (cellW + GAP));
      const dRow = Math.round(dy / (cellH + GAP));
      const newCol = Math.max(0, Math.min(BENTO_COLS - pos.w, pos.col + dCol));
      const newRow = Math.max(0, Math.min(BENTO_ROWS - pos.h, pos.row + dRow));
      setDragState((d) => d && { ...d, ghost: { ...pos, col: newCol, row: newRow } });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDragState((d) => {
        if (d && d.ghost) {
          setPositions((prev) => {
            // simple: if there's a swap candidate (exact same size), swap them
            const newPos = { ...prev, [id]: d.ghost };
            const conflicts = visibleIds.filter((vid) => vid !== id &&
              rectsOverlap(newPos[vid], d.ghost));
            if (conflicts.length === 1 && newPos[conflicts[0]].w === d.original.w &&
                newPos[conflicts[0]].h === d.original.h) {
              newPos[conflicts[0]] = { ...newPos[conflicts[0]], col: d.original.col, row: d.original.row };
              return newPos;
            }
            if (conflicts.length === 0) return newPos;
            return prev; // reject if blocked
          });
        }
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleResizeStart = (id) => (side, e) => {
    const pos = positions[id];
    if (!pos) return;
    const sx = e.clientX, sy = e.clientY;
    setDragState({ id, mode: "resize", original: { ...pos }, ghost: { ...pos } });
    const onMove = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      const dW = Math.round(dx / (cellW + GAP));
      const dH = Math.round(dy / (cellH + GAP));
      let newW = pos.w, newH = pos.h;
      if (side.includes("e")) newW = Math.max(2, Math.min(BENTO_COLS - pos.col, pos.w + dW));
      if (side.includes("s")) newH = Math.max(2, Math.min(BENTO_ROWS - pos.row, pos.h + dH));
      setDragState((d) => d && { ...d, ghost: { ...pos, w: newW, h: newH } });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDragState((d) => {
        if (d && d.ghost) {
          setPositions((prev) => {
            const newPos = { ...prev, [id]: d.ghost };
            const conflicts = visibleIds.filter((vid) => vid !== id &&
              rectsOverlap(newPos[vid], d.ghost));
            if (conflicts.length === 0) return newPos;
            return prev;
          });
        }
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="bento" ref={containerRef}>
      {/* Background grid hint when dragging */}
      {dragState && (
        <div className="bento-grid-hint" style={{
          backgroundSize: `${cellW + GAP}px ${cellH + GAP}px`,
        }}>
          <div className="bento-ghost" style={{
            ...cellToPx(dragState.ghost.col, dragState.ghost.row),
            ...sizeToPx(dragState.ghost.w, dragState.ghost.h),
          }}></div>
        </div>
      )}

      {visibleIds.map((id) => {
        const pos = positions[id];
        if (!pos) return null;
        const isDragging = dragState && dragState.id === id;
        const displayPos = isDragging ? dragState.ghost : pos;
        const px = cellToPx(displayPos.col, displayPos.row);
        const sz = sizeToPx(displayPos.w, displayPos.h);
        const reg = MODULE_REGISTRY[id];
        const isCompactLufs = id === "loudnessStats" && pos.w <= 3;
        return (
          <Module
            key={id}
            id={id}
            title={reg.title}
            focus={focusId === id}
            collapsed={collapsedIds.has(id)}
            draggable={!collapsedIds.has(id)}
            resizable={collapsedIds.has(id) ? null : ["se"]}
            onClose={() => onClose(id)}
            onCollapse={() => toggleCollapse(id)}
            onFullscreen={() => setFullscreenId(id)}
            onFocus={() => setFocusId(id)}
            onDragStart={handleDragStart(id)}
            onResizeStart={handleResizeStart(id)}
            showGrip
            dragging={isDragging}
            style={{
              position: "absolute",
              left: px.x, top: px.y,
              width: sz.w, height: sz.h,
              transition: isDragging ? "none" : "left 0.18s, top 0.18s",
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

      {visibleIds.length === 0 && (
        <div className="empty-hint">
          <div>No modules visible</div>
          <div>Use <code>+ Add Module</code> in the top bar to show one.</div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { BentoLayout, BENTO_DEFAULT });
