import { useCallback, useEffect, useRef, useState } from "react";
import {
  emitDockAccessoryAction,
  emitDockAccessoryPointer,
  emitDockAccessoryReady,
  listenDockAccessoryState,
} from "../../ipc/dockAccessoryEvents.js";
import { acceptAccessorySnapshot } from "../accessoryProtocol.js";

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
      setPayload(accepted.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    void emitDockAccessoryReady(surface);
    return () => {
      cancelled = true;
      unlisten?.();
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
  const pointer = useCallback((inside) => emitDockAccessoryPointer({ surface, inside }), [surface]);

  return { payload, action, pointer };
}
