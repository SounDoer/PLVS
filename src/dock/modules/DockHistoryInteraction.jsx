import { useHistoryData } from "../../workspace/AudioDataContext.jsx";
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
  const history = useHistoryData();
  const hud = controls?.dockHistoryHud;
  const selectedOffset = history?.selectedOffset ?? -1;
  const windowSec = controls?.dockHistoryWindowSec ?? 60;
  const selectionPct = Math.max(
    0,
    Math.min(100, 100 * (1 - selectedOffset / Math.max(0.1, windowSec - 0.1)))
  );
  return (
    <>
      {selectedOffset >= 0 ? (
        <div
          data-testid="dock-history-selection"
          className="pointer-events-none absolute inset-y-0 w-px bg-primary"
          style={{ left: `min(calc(100% - 1px), ${selectionPct}%)` }}
        />
      ) : null}
      {hud?.panelId === controls?.panelId && hud ? (
        <div
          role="status"
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-xs border border-border bg-background px-1.5 py-0.5 font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-dock-fs-value)] tabular-nums text-muted-foreground"
        >
          {fmtSec(hud.windowSec)}
        </div>
      ) : null}
    </>
  );
}
