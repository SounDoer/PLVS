import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { SCRIM_CLASS } from "@/components/ui/surfaceStyles.js";
import { cn } from "@/lib/utils";

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
    <div className={cn(SCRIM_CLASS, "pointer-events-none z-50 grid place-items-center")}>
      <div className="rounded-xl border border-border bg-popover px-6 py-5 text-center shadow-raised">
        <p className="text-[length:var(--ui-fs-body)] font-semibold text-foreground">
          Drop file to analyze
        </p>
        <p className="mt-1 text-[length:var(--ui-fs-control)] text-muted-foreground">
          Audio files and videos with audio tracks stay local.
        </p>
      </div>
    </div>
  );
}
