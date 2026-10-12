import { useCallback, useEffect, useRef, useState } from "react";
import {
  emitDockAccessoryAction,
  emitDockAccessoryFocus,
  emitDockAccessoryReady,
  listenDockAccessoryState,
} from "../../ipc/dockAccessoryEvents.js";
import { acceptAccessorySnapshot } from "../accessoryProtocol.js";
import { applyResolvedThemeToDocument, isThemePublication } from "../../theme/themeRuntime.js";

export function useAccessoryClient(surface) {
  const revisionRef = useRef(-1);
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    let unlisten;
    let cancelled = false;
    listenDockAccessoryState((snapshot) => {
      const accepted = acceptAccessorySnapshot(revisionRef.current, snapshot, surface);
      if (!accepted) return;
      revisionRef.current = accepted.revision;
      if (isThemePublication(accepted.payload.theme)) {
        applyResolvedThemeToDocument(accepted.payload.theme);
      }
      setPayload(accepted.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else {
        unlisten = fn;
        void emitDockAccessoryReady(surface);
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [surface]);

  useEffect(() => {
    const onFocus = () => void emitDockAccessoryFocus({ surface, focused: true });
    const onBlur = () => void emitDockAccessoryFocus({ surface, focused: false });
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [surface]);

  const action = useCallback(
    (type, actionPayload = {}) =>
      emitDockAccessoryAction({
        surface,
        type,
        revision: Math.max(0, revisionRef.current),
        payload: actionPayload,
      }),
    [surface]
  );

  return { payload, action };
}
