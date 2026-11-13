import { useEffect, useEffectEvent, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileAudio } from "lucide-react";
import { POPOVER_SURFACE_CLASS, SCRIM_CLASS } from "@/components/ui/surfaceStyles.js";
import { cn } from "@/lib/utils";
import { LAYER_FLOATING } from "@/components/ui/layers.js";

// Drag/drop is wired through the Tauri webview drag-drop event, which yields real filesystem
// paths (unlike HTML5 `dataTransfer`). The overlay subscribes only while File mode is active, so
// OS file drags in Live mode are ignored entirely (no drop-while-live confirmation).
export function FileDropOverlay({ active, onDropFile, showScrim = true }) {
  const [count, setCount] = useState(0);
  const deliverDrop = useEffectEvent((paths) => {
    onDropFile(paths.length === 1 ? paths[0] : paths);
  });

  useEffect(() => {
    if (!active) {
      setCount(0);
      return undefined;
    }
    let unlisten = null;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (cancelled) return;
        const payload = event?.payload;
        if (!payload) return;
        if (payload.type === "enter") {
          setCount(payload.paths?.length || 1);
        } else if (payload.type === "over") {
          setCount((previous) => previous || 1);
        } else if (payload.type === "leave") {
          setCount(0);
        } else if (payload.type === "drop") {
          setCount(0);
          const paths = payload.paths ?? [];
          if (paths.length) deliverDrop(paths);
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
      setCount(0);
    };
  }, [active]);

  if (!count) return null;

  return (
    <div
      className={cn(
        showScrim ? SCRIM_CLASS : "absolute inset-0",
        LAYER_FLOATING,
        "pointer-events-none grid place-items-center p-4"
      )}
    >
      <div
        className={cn(
          POPOVER_SURFACE_CLASS,
          "flex min-w-0 items-center gap-3 px-4 py-3 text-[length:var(--ui-fs-body)]"
        )}
      >
        <FileAudio aria-hidden="true" className="size-[1.25em] shrink-0 text-primary" />
        <p className="min-w-0 font-semibold">
          {count === 1 ? "Drop File to Analyze" : `Drop ${count} Files to Analyze`}
        </p>
      </div>
    </div>
  );
}
