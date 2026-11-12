import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileAudio } from "lucide-react";
import { POPOVER_SURFACE_CLASS, SCRIM_CLASS } from "@/components/ui/surfaceStyles.js";
import { cn } from "@/lib/utils";
import { LAYER_FLOATING } from "@/components/ui/layers.js";

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
    <div
      className={cn(SCRIM_CLASS, LAYER_FLOATING, "pointer-events-none grid place-items-center p-4")}
    >
      <div
        className={cn(
          POPOVER_SURFACE_CLASS,
          "flex min-w-0 items-center gap-3 px-4 py-3 text-[length:var(--ui-fs-body)]"
        )}
      >
        <FileAudio aria-hidden="true" className="size-[1.25em] shrink-0 text-primary" />
        <p className="min-w-0 font-semibold">Drop File to Analyze</p>
      </div>
    </div>
  );
}
