import { fmtSec } from "../../math/formatMath.js";

export function dockHistoryInteractionProps(controls) {
  return {
    onWheel: (event) => {
      event.preventDefault();
      controls?.onDockHistoryWheel?.(controls.panelId, event.deltaY);
    },
    onPointerDown: (event) => {
      if (event.button !== 2) return;
      event.preventDefault();
      controls?.onDockHistoryPointerDown?.(controls.panelId, event.button, event.timeStamp);
    },
    onContextMenu: (event) => event.preventDefault(),
  };
}

export function DockHistoryWindowHud({ controls }) {
  const hud = controls?.dockHistoryHud;
  if (!hud || hud.panelId !== controls?.panelId) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded border border-border/60 bg-background/85 px-1.5 py-0.5 font-[family-name:var(--ui-font-mono)] text-[10px] tabular-nums text-muted-foreground shadow-sm"
    >
      {fmtSec(hud.windowSec)}
    </div>
  );
}
