import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc/env.js";
import {
  emitDockAccessoryState,
  listenDockAccessoryAction,
  listenDockAccessoryReady,
} from "../ipc/dockAccessoryEvents.js";
import { createAccessorySnapshot, normalizeAccessoryAction } from "./accessoryProtocol.js";
import { createThemePublication, themeRuntime } from "../theme/themeRuntime.js";

/**
 * The native window is created on demand only when an import needs presentation.
 */
export function useDockImportWindow({
  active,
  prepare = false,
  edge,
  payload,
  onAction,
  onGeometry,
}) {
  const latest = useRef({ payload, onAction });
  const revision = useRef(0);
  const [contentSize, setContentSize] = useState({ key: null, height: 240 });
  const [readyKey, setReadyKey] = useState(null);
  const [error, setError] = useState(null);
  const [prepared, setPrepared] = useState(false);
  const serializedPayload = JSON.stringify(payload);
  useLayoutEffect(() => {
    latest.current = { payload, onAction };
  }, [payload, onAction]);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisteners = [];
    const publish = () =>
      emitDockAccessoryState(
        "dock-import",
        createAccessorySnapshot("dock-import", ++revision.current, {
          ...latest.current.payload,
          theme: createThemePublication(themeRuntime.getSnapshot()),
        })
      ).catch((error) => {
        if (!disposed) setError(String(error));
      });
    void Promise.allSettled([
      listenDockAccessoryReady((event) => {
        if (event?.surface === "dock-import") void publish();
      }),
      listenDockAccessoryAction((raw) => {
        const action = normalizeAccessoryAction(raw);
        if (!action || action.surface !== "dock-import") return;
        if (action.payload.key !== latest.current.payload.key) return;
        if (action.type === "import-ready") setReadyKey(action.payload.key);
        else if (action.type === "import-resize") {
          const { key, height } = action.payload;
          if (Number.isFinite(height) && height > 0) {
            setContentSize({ key, height: Math.min(2000, Math.ceil(height)) });
          }
        } else latest.current.onAction(action);
      }),
    ]).then((results) => {
      const listeners = [];
      for (const result of results) {
        if (result.status === "fulfilled") listeners.push(result.value);
        else if (!disposed) setError(String(result.reason));
      }
      if (disposed) listeners.forEach((dispose) => dispose());
      else {
        unlisteners = listeners;
        void publish();
      }
    });
    const stopTheme = themeRuntime.subscribe(
      (resolved) => resolved,
      () => void publish()
    );
    return () => {
      disposed = true;
      stopTheme();
      unlisteners.forEach((dispose) => dispose());
    };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    void emitDockAccessoryState(
      "dock-import",
      createAccessorySnapshot("dock-import", ++revision.current, {
        ...JSON.parse(serializedPayload),
        theme: createThemePublication(themeRuntime.getSnapshot()),
      })
    ).catch((error) => setError(String(error)));
  }, [serializedPayload]);
  useEffect(() => {
    if (!isTauri() || !active || !prepared || !payload.key || readyKey === payload.key) return;
    const timer = setTimeout(() => setError("Dock import window did not become ready."), 5000);
    return () => clearTimeout(timer);
  }, [active, prepared, payload.key, readyKey]);
  const needed = prepare || active;
  useEffect(() => {
    if (!isTauri() || !needed || prepared) return;
    let cancelled = false;
    // A new accessory announces readiness, which publishes the current state to it.
    void invoke("prepare_dock_import_window")
      .then(() => {
        if (!cancelled) setPrepared(true);
      })
      .catch((error) => {
        if (!cancelled) setError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [needed, prepared]);
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void invoke("set_dock_import_window", {
      visible: active && readyKey === payload.key,
      edge,
      webviewScale: window.devicePixelRatio,
      contentHeight: contentSize.key === payload.key ? contentSize.height : 240,
    })
      .then((rect) => {
        if (!cancelled)
          onGeometry(
            rect
              ? {
                  visible: true,
                  width: rect.width / window.devicePixelRatio,
                  height: rect.height / window.devicePixelRatio,
                }
              : null
          );
      })
      .catch((error) => {
        if (!cancelled) setError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [active, edge, payload.key, readyKey, contentSize, onGeometry]);
  return { error, clearError: () => setError(null) };
}
