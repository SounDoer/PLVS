import { useCallback, useEffect, useRef, useState } from "react";
import {
  emitDockAccessoryState,
  listenDockAccessoryAction,
  listenDockAccessoryFocus,
  listenDockAccessoryReady,
} from "../ipc/dockAccessoryEvents.js";
import {
  createAccessorySnapshot,
  isDockAccessorySurface,
  normalizeAccessoryAction,
  normalizeAccessoryFocus,
} from "./accessoryProtocol.js";
import { createThemePublication, themeRuntime } from "../theme/themeRuntime.js";

export function useDockAccessoryBridge({ active, headerState, editorState, onAction, onFocus }) {
  const [theme, setTheme] = useState(() => createThemePublication(themeRuntime.getSnapshot()));
  const revisionRef = useRef(0);
  const latestRef = useRef({ headerState, editorState, theme });
  const onActionRef = useRef(onAction);
  const onFocusRef = useRef(onFocus);

  useEffect(() => {
    latestRef.current = { headerState, editorState, theme };
    onActionRef.current = onAction;
    onFocusRef.current = onFocus;
  }, [editorState, headerState, onAction, onFocus, theme]);

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
        if (action && action.surface !== "dock-update") onActionRef.current?.(action);
      }),
      listenDockAccessoryFocus((raw) => {
        const focus = normalizeAccessoryFocus(raw);
        if (focus && focus.surface !== "dock-update") onFocusRef.current?.(focus);
      }),
      listenDockAccessoryReady((raw) => {
        if (!isDockAccessorySurface(raw?.surface) || raw.surface === "dock-update") return;
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
