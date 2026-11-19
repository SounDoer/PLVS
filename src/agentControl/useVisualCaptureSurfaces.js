import { useEffect, useMemo, useRef } from "react";
import { settleVisualSurface, subscribeVisualSurfaceResize } from "./visualSurfaces.js";

export function useVisualCaptureSurfaces({ workspace, dockEdge = null, windowLabel = "main" }) {
  const currentRef = useRef({ workspace, windowLabel });
  const pendingRef = useRef(new Set());
  const subscriptionsRef = useRef(new Set());
  const dockEdgeListeners = useRef(new Set());
  currentRef.current = { workspace, windowLabel };

  useEffect(() => {
    if (dockEdge) for (const onEdge of dockEdgeListeners.current) onEdge(dockEdge);
  }, [dockEdge]);

  useEffect(
    () => () => {
      for (const controller of pendingRef.current) controller.abort();
      pendingRef.current.clear();
      for (const unsubscribe of subscriptionsRef.current) unsubscribe();
      subscriptionsRef.current.clear();
    },
    []
  );

  return useMemo(
    () => ({
      async settle(target, options) {
        const controller = new AbortController();
        pendingRef.current.add(controller);
        const onExternalAbort = () => controller.abort();
        options?.signal?.addEventListener("abort", onExternalAbort, { once: true });
        try {
          return await settleVisualSurface({
            ...currentRef.current,
            ...options,
            target,
            signal: controller.signal,
          });
        } finally {
          options?.signal?.removeEventListener("abort", onExternalAbort);
          pendingRef.current.delete(controller);
        }
      },
      subscribe(target, onGeometry, options = {}) {
        const unsubscribeSurface = subscribeVisualSurfaceResize({
          ...currentRef.current,
          ...options,
          target,
          onGeometry,
          dockEdgeListeners: options.followDockEdge ? dockEdgeListeners.current : undefined,
        });
        const unsubscribe = () => {
          unsubscribeSurface();
          subscriptionsRef.current.delete(unsubscribe);
        };
        subscriptionsRef.current.add(unsubscribe);
        return unsubscribe;
      },
    }),
    []
  );
}
