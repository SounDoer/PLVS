import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

// Drag/drop is wired through the Tauri webview drag-drop event, which yields real filesystem
// paths (unlike HTML5 `dataTransfer`). The overlay subscribes only while File mode is active, so
// OS file drags in Live mode are ignored entirely (no drop-while-live confirmation).
export function FileDropOverlay({ active, onDropFile }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);
      return undefined;
    }
    let unlisten = null;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event?.payload;
        if (!payload) return;
        if (payload.type === "enter" || payload.type === "over") {
          setVisible(true);
        } else if (payload.type === "leave") {
          setVisible(false);
        } else if (payload.type === "drop") {
          setVisible(false);
          const path = payload.paths?.[0];
          if (path) onDropFile(path);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      setVisible(false);
    };
  }, [active, onDropFile]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm">
      <div className="rounded-xl border border-primary/40 bg-popover px-6 py-5 text-center shadow-lg">
        <p className="text-sm font-semibold text-foreground">Drop file to analyze</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Audio files and videos with audio tracks stay local.
        </p>
      </div>
    </div>
  );
}
