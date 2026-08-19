import { useCallback, useEffect, useRef, useState } from "react";
import {
  emitDockAccessoryState,
  listenDockAccessoryAction,
  listenDockAccessoryPointer,
  listenDockAccessoryReady,
} from "../ipc/dockAccessoryEvents.js";
import {
  createAccessorySnapshot,
  isDockAccessorySurface,
  normalizeAccessoryAction,
  normalizeAccessoryPointer,
} from "./accessoryProtocol.js";
import { createThemePublication, themeRuntime } from "../theme/themeRuntime.js";

export function useDockAccessoryBridge({ active, headerState, editorState, onAction, onPointer }) {
  const [theme, setTheme] = useState(() => createThemePublication(themeRuntime.getSnapshot()));
  const revisionRef = useRef(0);
  const latestRef = useRef({ headerState, editorState, theme });
  const onActionRef = useRef(onAction);
  const onPointerRef = useRef(onPointer);

  useEffect(() => {
    latestRef.current = { headerState, editorState, theme };
    onActionRef.current = onAction;
    onPointerRef.current = onPointer;
  }, [editorState, headerState, onAction, onPointer, theme]);

  useEffect(
    () =>
      themeRuntime.subscribe(
        (resolved) => resolved,
        (resolved) => setTheme(createThemePublication(resolved))
      ),
    []
  );

  const withTheme = useCallback((payload) => (theme ? { ...payload, theme } : payload), [theme]);

  const publish = useCallback(async (surface, payload) => {
    const snapshot = createAccessorySnapshot(surface, ++revisionRef.current, payload);
    if (snapshot) await emitDockAccessoryState(surface, snapshot);
  }, []);

  useEffect(() => {
    if (!active) return;
    void publish("dock-header", withTheme(headerState));
  }, [active, headerState, publish, withTheme]);

  useEffect(() => {
    if (!active) return;
    void publish("dock-editor", withTheme(editorState));
  }, [active, editorState, publish, withTheme]);

  useEffect(() => {
    if (!active) return;
    const unlisteners = [];
    let cancelled = false;
    Promise.all([
      listenDockAccessoryAction((raw) => {
        const action = normalizeAccessoryAction(raw);
        if (action) onActionRef.current?.(action);
      }),
      listenDockAccessoryPointer((raw) => {
        const pointer = normalizeAccessoryPointer(raw);
        if (pointer) onPointerRef.current?.(pointer);
      }),
      listenDockAccessoryReady((raw) => {
        if (!isDockAccessorySurface(raw?.surface)) return;
        const payload =
          raw.surface === "dock-header"
            ? latestRef.current.headerState
            : latestRef.current.editorState;
        const latestTheme = latestRef.current.theme;
        void publish(raw.surface, latestTheme ? { ...payload, theme: latestTheme } : payload);
      }),
    ]).then((resolved) => {
      if (cancelled) resolved.forEach((unlisten) => unlisten());
      else unlisteners.push(...resolved);
    });
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [active, publish]);
}
