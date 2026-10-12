import { useCallback, useEffect, useRef, useState } from "react";
import { setDockAccessories } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { shouldShowDockHeader } from "./accessoryVisibility.js";

const ACCESSORY_READY_RETRY_MS = 50;
const ACCESSORY_READY_ATTEMPTS = 4;
// Focus hops between the strip, the header and the editor pass through a moment where none of
// them has it. Longer than the editor's own 100 ms blur delay, so the editor settles first.
const TOOLBAR_FOCUS_GRACE_MS = 150;

/**
 * @param {string} view
 */
function initialEditorSize(view) {
  if (view === "presets") return { width: 240, height: 560 };
  if (view === "loudness-profile") return { width: 240, height: 320 };
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
    wait = (/** @type {number} */ delay) => new Promise((resolve) => setTimeout(resolve, delay)),
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

/** @param {{ command?: any }} [options] */
export function createLatestDockAccessoryUpdater({ command = setDockAccessoriesWhenReady } = {}) {
  let latestRequest = 0;
  let pending = null;
  let running = false;

  const drain = async () => {
    running = true;
    while (pending !== null) {
      const current = pending;
      pending = null;
      try {
        await command(current.options);
      } catch (error) {
        if (current.request === latestRequest) current.onError?.(error);
      }
    }
    running = false;
  };

  return {
    update(options, onError) {
      latestRequest += 1;
      pending = { request: latestRequest, options, onError };
      if (!running) void drain();
    },
  };
}

/**
 * @param {{
 *   active: boolean,
 *   edge: string,
 *   geometryVersion: number,
 *   forceHeaderVisible?: boolean,
 *   onError: (...args: any[]) => any,
 * }} options
 */
export function useDockAccessoryVisibility({
  active,
  edge,
  geometryVersion,
  forceHeaderVisible = false,
  onError,
}) {
  const [toolbarOpen, setToolbarOpenState] = useState(false);
  const [editorView, setEditorView] = useState(null);
  const [editorSize, setEditorSize] = useState(() => initialEditorSize(null));
  const [editorAnchorX, setEditorAnchorX] = useState(null);
  const [measuredEditorView, setMeasuredEditorView] = useState(null);
  const toolbarOpenRef = useRef(false);
  const editorViewRef = useRef(null);
  const measuredEditorViewRef = useRef(null);
  const focusRef = useRef({ strip: false, "dock-header": false, "dock-editor": false });
  const focusTimerRef = useRef(null);
  const accessoryUpdaterRef = useRef(null);
  if (accessoryUpdaterRef.current === null) {
    accessoryUpdaterRef.current = createLatestDockAccessoryUpdater();
  }

  const headerVisible =
    active &&
    shouldShowDockHeader({
      userOpen: toolbarOpen,
      editorOpen: editorView !== null,
      forceVisible: forceHeaderVisible,
    });

  const setToolbarOpen = useCallback((open) => {
    toolbarOpenRef.current = open;
    setToolbarOpenState(open);
  }, []);

  const openEditor = useCallback((view, anchorX) => {
    const hasVisibleEditor =
      editorViewRef.current !== null && measuredEditorViewRef.current === editorViewRef.current;
    if (!hasVisibleEditor) {
      setEditorSize(initialEditorSize(view));
      measuredEditorViewRef.current = null;
      setMeasuredEditorView(null);
    }
    editorViewRef.current = view;
    if (Number.isFinite(anchorX)) setEditorAnchorX(anchorX);
    setEditorView(view);
  }, []);
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

  const toggleToolbar = useCallback(() => {
    if (toolbarOpenRef.current || editorViewRef.current !== null) {
      closeEditor();
      setToolbarOpen(false);
    } else {
      setToolbarOpen(true);
    }
  }, [closeEditor, setToolbarOpen]);
  const dismiss = useCallback(() => {
    if (editorViewRef.current !== null) closeEditor();
    else setToolbarOpen(false);
  }, [closeEditor, setToolbarOpen]);

  const reportFocus = useCallback(
    (surface, focused) => {
      if (!(surface in focusRef.current)) return;
      focusRef.current[surface] = focused;
      if (focusTimerRef.current !== null) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
      if (Object.values(focusRef.current).some(Boolean)) return;
      focusTimerRef.current = setTimeout(() => {
        focusTimerRef.current = null;
        setToolbarOpen(false);
      }, TOOLBAR_FOCUS_GRACE_MS);
    },
    [setToolbarOpen]
  );
  const onAccessoryFocus = useCallback(
    ({ surface, focused }) => reportFocus(surface, focused),
    [reportFocus]
  );

  useEffect(() => {
    if (active) return;
    const resetTimer = setTimeout(() => {
      editorViewRef.current = null;
      measuredEditorViewRef.current = null;
      setMeasuredEditorView(null);
      setEditorView(null);
      setEditorAnchorX(null);
      setToolbarOpen(false);
    }, 0);
    return () => clearTimeout(resetTimer);
  }, [active, setToolbarOpen]);

  useEffect(() => {
    if (!active) return;
    const onFocus = () => reportFocus("strip", true);
    const onBlur = () => reportFocus("strip", false);
    const onKeyDown = (event) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown);
      if (focusTimerRef.current !== null) {
        clearTimeout(focusTimerRef.current);
        focusTimerRef.current = null;
      }
    };
  }, [active, dismiss, reportFocus]);

  useEffect(() => {
    if (headerVisible) return;
    // A window hidden while it holds focus may never report the blur.
    focusRef.current["dock-header"] = false;
    focusRef.current["dock-editor"] = false;
  }, [headerVisible]);

  useEffect(() => {
    if (!isTauri()) return;
    accessoryUpdaterRef.current.update(
      {
        edge,
        headerVisible,
        editorVisible: active && editorView !== null && measuredEditorView !== null,
        editorWidth: editorSize.width,
        editorHeight: editorSize.height,
        editorAnchorX,
      },
      onError
    );
  }, [
    active,
    edge,
    editorSize,
    editorAnchorX,
    editorView,
    geometryVersion,
    headerVisible,
    measuredEditorView,
    onError,
  ]);

  return {
    headerVisible,
    editorView,
    editorVisible: editorView !== null && measuredEditorView === editorView,
    editorSize,
    toggleToolbar,
    dismiss,
    onAccessoryFocus,
    openEditor,
    closeEditor,
    resizeEditor,
  };
}
