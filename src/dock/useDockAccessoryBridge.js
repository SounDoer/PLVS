import { useCallback, useEffect, useRef } from "react";
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

export function useDockAccessoryBridge({ active, headerState, editorState, onAction, onPointer }) {
  const revisionRef = useRef(0);
  const latestRef = useRef({ headerState, editorState });
  const onActionRef = useRef(onAction);
  const onPointerRef = useRef(onPointer);

  useEffect(() => {
    latestRef.current = { headerState, editorState };
    onActionRef.current = onAction;
    onPointerRef.current = onPointer;
  }, [editorState, headerState, onAction, onPointer]);

  const publish = useCallback(async (surface, payload) => {
    const snapshot = createAccessorySnapshot(surface, ++revisionRef.current, payload);
    if (snapshot) await emitDockAccessoryState(surface, snapshot);
  }, []);

  useEffect(() => {
    if (!active) return;
    void publish("dock-header", headerState);
  }, [active, headerState, publish]);

  useEffect(() => {
    if (!active) return;
    void publish("dock-editor", editorState);
  }, [active, editorState, publish]);

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
        void publish(raw.surface, payload);
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
