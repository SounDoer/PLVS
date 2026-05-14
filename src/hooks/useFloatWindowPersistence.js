import { useEffect, useRef } from "react";
import { isTauri } from "../ipc/env.js";
import { saveFloatWindowBounds, getCurrentFloatWindow } from "../ipc/floatWindowPrefs.js";

/**
 * Debounced save of outer size/position on resize and move, plus a best-effort flush on
 * `pagehide` when the user closes the float (no `onCloseRequested` — see below).
 *
 * Do **not** use `Window.onCloseRequested` or `listen("tauri://close-requested")` here: Tauri's
 * `onCloseRequested` wraps the event and only closes via `destroy()` afterward; for child
 * / parent-tied webview windows that path can fail and leave the × non-functional. Relying on
 * the native close path keeps the float dismissible; bounds are still persisted after moves/resizes.
 * Persists logical inner size and outer top-left (innerSize/outerPosition + scaleFactor) to
 * match `WebviewWindow` `width`/`height`/`x`/`y` in logical pixels.
 *
 * @param {string} kind panel id (peak, loudness, …)
 */
export function useFloatWindowPersistence(kind) {
  const kindRef = useRef(kind);
  useEffect(() => {
    kindRef.current = kind;
  }, [kind]);

  useEffect(() => {
    if (!isTauri()) return undefined;
    const w = getCurrentFloatWindow();
    let debounceT = 0;
    const save = () => {
      void (async () => {
        try {
          const factor = await w.scaleFactor();
          const [inner, pos] = await Promise.all([w.innerSize(), w.outerPosition()]);
          const lSize = inner.toLogical(factor);
          const lPos = pos.toLogical(factor);
          await saveFloatWindowBounds(kindRef.current, {
            width: lSize.width,
            height: lSize.height,
            x: lPos.x,
            y: lPos.y,
          });
        } catch {
          /* store / ipc */
        }
      })();
    };
    const scheduleSave = () => {
      clearTimeout(debounceT);
      debounceT = setTimeout(save, 500);
    };
    const onPageHide = () => {
      clearTimeout(debounceT);
      save();
    };
    const p = Promise.all([w.onResized(() => scheduleSave()), w.onMoved(() => scheduleSave())]);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      clearTimeout(debounceT);
      void p.then(([a, b]) => {
        try {
          a();
        } catch {
          /* noop */
        }
        try {
          b();
        } catch {
          /* noop */
        }
      });
    };
  }, []);
}
