import { useCallback, useEffect, useRef, useState } from "react";
import { setDockAccessories } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { DOCK_ACCESSORY_HIDE_DELAY_MS, shouldShowDockHeader } from "./accessoryVisibility.js";

const ACCESSORY_READY_RETRY_MS = 50;
const ACCESSORY_READY_ATTEMPTS = 4;

function initialEditorSize(view) {
  if (view === "presets") return { width: 240, height: 560 };
  if (view === "modules") return { width: 320, height: 480 };
  return { width: 400, height: 480 };
}

function isAccessoryUnavailable(error) {
  return /dock (?:header|editor) window unavailable/i.test(error?.message || String(error));
}

export async function setDockAccessoriesWhenReady(
  options,
  {
    command = setDockAccessories,
    wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay)),
  } = {}
) {
  for (let attempt = 1; attempt <= ACCESSORY_READY_ATTEMPTS; attempt += 1) {
    try {
      return await command(options);
    } catch (error) {
      if (attempt === ACCESSORY_READY_ATTEMPTS || !isAccessoryUnavailable(error)) throw error;
      await wait(ACCESSORY_READY_RETRY_MS);
    }
  }
}

export function useDockAccessoryVisibility({ active, edge, onError }) {
  const [presence, setPresence] = useState({ stripInside: false, headerInside: false });
  const [headerVisible, setHeaderVisible] = useState(false);
  const [editorView, setEditorView] = useState(null);
  const [editorSize, setEditorSize] = useState(() => initialEditorSize(null));
  const [measuredEditorView, setMeasuredEditorView] = useState(null);
  const editorViewRef = useRef(null);
  const measuredEditorViewRef = useRef(null);
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
      setEditorSize(initialEditorSize(view));
      measuredEditorViewRef.current = null;
      setMeasuredEditorView(null);
      editorViewRef.current = view;
      setEditorView(view);
      setHeaderVisible(true);
    },
    [clearHideTimer]
  );
  const closeEditor = useCallback((expectedView, reason) => {
    if (expectedView && editorViewRef.current !== expectedView) return;
    if (reason === "blur" && measuredEditorViewRef.current !== editorViewRef.current) return;
    editorViewRef.current = null;
    measuredEditorViewRef.current = null;
    setMeasuredEditorView(null);
    setEditorView(null);
  }, []);
  const resizeEditor = useCallback(({ view, width, height }) => {
    if (!view || editorViewRef.current !== view) return;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const next = {
      width: Math.max(176, Math.min(400, Math.ceil(width))),
      height: Math.max(80, Math.min(640, Math.ceil(height))),
    };
    setEditorSize((current) =>
      current.width === next.width && current.height === next.height ? current : next
    );
    measuredEditorViewRef.current = view;
    setMeasuredEditorView(view);
  }, []);

  useEffect(() => {
    if (!active) {
      clearHideTimer();
      const resetTimer = setTimeout(() => {
        editorViewRef.current = null;
        measuredEditorViewRef.current = null;
        setMeasuredEditorView(null);
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
        setDockAccessoriesWhenReady({
          edge,
          headerVisible: active && headerVisible,
          editorVisible: active && editorView !== null && measuredEditorView === editorView,
          editorWidth: editorSize.width,
          editorHeight: editorSize.height,
        })
      );
    void commandQueueRef.current.catch((error) => {
      if (request === requestRef.current) onError?.(error);
    });
  }, [active, edge, editorSize, editorView, headerVisible, measuredEditorView, onError]);

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
    resizeEditor,
  };
}
