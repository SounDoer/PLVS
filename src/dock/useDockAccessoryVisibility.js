import { useCallback, useEffect, useRef, useState } from "react";
import { setDockAccessories } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { DOCK_ACCESSORY_HIDE_DELAY_MS, shouldShowDockHeader } from "./accessoryVisibility.js";

export function useDockAccessoryVisibility({ active, edge, onError }) {
  const [presence, setPresence] = useState({ stripInside: false, headerInside: false });
  const [headerVisible, setHeaderVisible] = useState(false);
  const [editorView, setEditorView] = useState(null);
  const hideTimerRef = useRef(null);
  const requestRef = useRef(0);
  const commandQueueRef = useRef(Promise.resolve());

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const updatePresence = useCallback(
    (key, inside) => {
      clearHideTimer();
      setPresence((current) => ({ ...current, [key]: inside }));
      if (inside) setHeaderVisible(true);
    },
    [clearHideTimer]
  );

  const openEditor = useCallback(
    (view) => {
      clearHideTimer();
      setEditorView(view);
      setHeaderVisible(true);
    },
    [clearHideTimer]
  );
  const closeEditor = useCallback(() => setEditorView(null), []);

  useEffect(() => {
    if (!active) {
      clearHideTimer();
      const resetTimer = setTimeout(() => {
        setHeaderVisible(false);
        setEditorView(null);
        setPresence({ stripInside: false, headerInside: false });
      }, 0);
      return () => clearTimeout(resetTimer);
    }
    if (shouldShowDockHeader({ ...presence, editorOpen: editorView !== null })) {
      const showTimer = setTimeout(() => setHeaderVisible(true), 0);
      return () => clearTimeout(showTimer);
    }
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setHeaderVisible(false), DOCK_ACCESSORY_HIDE_DELAY_MS);
    return clearHideTimer;
  }, [active, clearHideTimer, editorView, presence]);

  useEffect(() => {
    if (!isTauri()) return;
    const request = ++requestRef.current;
    commandQueueRef.current = commandQueueRef.current
      .catch(() => {})
      .then(() =>
        setDockAccessories({
          edge,
          headerVisible: active && headerVisible,
          editorVisible: active && editorView !== null,
          editorHeight: editorView === "presets" ? 560 : 480,
        })
      );
    void commandQueueRef.current.catch((error) => {
      if (request === requestRef.current) onError?.(error);
    });
  }, [active, edge, editorView, headerVisible, onError]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  return {
    headerVisible,
    editorView,
    onStripPointerEnter: () => updatePresence("stripInside", true),
    onStripPointerLeave: () => updatePresence("stripInside", false),
    onAccessoryPointer: ({ surface, inside }) => {
      if (surface === "dock-header") updatePresence("headerInside", inside);
    },
    openEditor,
    closeEditor,
  };
}
