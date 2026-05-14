// ====================================================================
// Module chrome — shared <Module> wrapper used by all 3 layout systems
// Provides: header (drag handle + collapse/fullscreen/close buttons),
//           resize handles (caller decides which sides)
// ====================================================================

function IconCollapse({ collapsed }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      {collapsed
        ? <path d="M3 6h6M6 3v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        : <path d="M3 6h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
    </svg>
  );
}

function IconFullscreen({ active }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      {active
        ? <path d="M5 1v4H1M11 5H7V1M7 11V7h4M1 7h4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        : <path d="M2 4V2h2M10 4V2H8M2 8v2h2M10 8v2H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconGrip() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="none" style={{ flexShrink: 0, opacity: 0.55 }}>
      <circle cx="3" cy="3" r="1" fill="currentColor" />
      <circle cx="7" cy="3" r="1" fill="currentColor" />
      <circle cx="3" cy="7" r="1" fill="currentColor" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
      <circle cx="3" cy="11" r="1" fill="currentColor" />
      <circle cx="7" cy="11" r="1" fill="currentColor" />
    </svg>
  );
}

function Module({
  id,
  title,
  children,
  collapsed = false,
  fullscreen = false,
  draggable = false,
  resizable = null,            // null | 'se' | ['e','s','se'] etc.
  focus = false,
  onClose,
  onCollapse,
  onFullscreen,
  onDragStart,
  onResizeStart,
  onFocus,
  style,
  className = "",
  showGrip = false,
  dragging = false,
}) {
  const handleHeaderDown = (e) => {
    if (!draggable || !onDragStart) return;
    if (e.target.closest("button")) return; // header buttons shouldn't drag
    e.preventDefault();
    onDragStart(e);
  };
  const handleResize = (side) => (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (onResizeStart) onResizeStart(side, e);
  };

  const cls = [
    "module",
    collapsed && "collapsed",
    focus && "focus",
    dragging && "dragging",
    fullscreen && "module-fullscreen",
    className,
  ].filter(Boolean).join(" ");

  const resizeSides = Array.isArray(resizable) ? resizable : (resizable ? [resizable] : []);

  return (
    <div
      className={cls}
      style={style}
      onMouseDown={onFocus}
    >
      <div
        className={"module-header " + (draggable ? "draggable" : "")}
        onMouseDown={handleHeaderDown}
      >
        {showGrip && <IconGrip />}
        <div className="module-title">
          <span className="title-dot"></span>
          {title}
        </div>
        <div className="module-actions">
          {onCollapse && (
            <button title={collapsed ? "Expand" : "Collapse"} onClick={(e) => { e.stopPropagation(); onCollapse(); }}>
              <IconCollapse collapsed={collapsed} />
            </button>
          )}
          {onFullscreen && (
            <button title={fullscreen ? "Exit fullscreen" : "Fullscreen"} onClick={(e) => { e.stopPropagation(); onFullscreen(); }}>
              <IconFullscreen active={fullscreen} />
            </button>
          )}
          {onClose && (
            <button className="close" title="Hide" onClick={(e) => { e.stopPropagation(); onClose(); }}>
              <IconClose />
            </button>
          )}
        </div>
      </div>
      <div className="module-body">{children}</div>
      {!collapsed && resizeSides.map((side) => (
        <div
          key={side}
          className={"resize-handle " + side}
          onMouseDown={handleResize(side)}
        ></div>
      ))}
    </div>
  );
}

// Hook for tracking mouse drag with a callback
function useDrag(onMove, onEnd) {
  const startRef = React.useRef(null);
  const begin = (e) => {
    const sx = e.clientX, sy = e.clientY;
    startRef.current = { sx, sy };
    const move = (ev) => {
      onMove(ev.clientX - sx, ev.clientY - sy, ev.clientX, ev.clientY, ev);
    };
    const up = (ev) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (onEnd) onEnd(ev);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return begin;
}

// Generic popover
function Popover({ open, onClose, anchor = "bottom-right", children, style }) {
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!e.target.closest(".popover") && !e.target.closest("[data-popover-trigger]")) {
        onClose();
      }
    };
    setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  if (!open) return null;
  return <div className="popover" style={style}>{children}</div>;
}

Object.assign(window, {
  Module, IconClose, IconFullscreen, IconCollapse, IconGrip, useDrag, Popover,
});
