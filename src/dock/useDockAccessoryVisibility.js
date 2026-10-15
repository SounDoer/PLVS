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
 *   snapshotActive?: boolean,
 *   waitForHeaderReady?: boolean,
 *   onError: (...args: any[]) => any,
 * }} options
 */
export function useDockAccessoryVisibility({
  active,
  edge,
  geometryVersion,
  forceHeaderVisible = false,
  snapshotActive = false,
  waitForHeaderReady = false,
  onError,
}) {
  const [toolbarOpen, setToolbarOpenState] = useState(false);
  const snapshotSession = active && snapshotActive;
  const [snapshotToolbar, setSnapshotToolbar] = useState({
    session: snapshotSession,
    dismissed: false,
  });
  // A new snapshot (or entry into Dock with one selected) gets one automatic reveal.
  // Keep this separate from the user's open state so returning Live restores that state.
  if (snapshotToolbar.session !== snapshotSession) {
    setSnapshotToolbar({ session: snapshotSession, dismissed: false });
  }
  const snapshotOpen = snapshotSession && !snapshotToolbar.dismissed;
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
      userOpen: toolbarOpen || snapshotOpen,
      editorOpen: editorView !== null,
      forceVisible: forceHeaderVisible,
    });

  const presentationKey = `${headerVisible}:${snapshotActive}`;
  const [presentation, setPresentation] = useState({ key: presentationKey, id: 0 });
  if (presentation.key !== presentationKey) {
    setPresentation({ key: presentationKey, id: presentation.id + 1 });
  }
  const [preparedHeaderId, setPreparedHeaderId] = useState(-1);
  const confirmHeaderReady = useCallback((id) => {
    if (Number.isSafeInteger(id)) setPreparedHeaderId((current) => Math.max(current, id));
  }, []);
  const nativeHeaderVisible =
    headerVisible && (!waitForHeaderReady || preparedHeaderId === presentation.id);

  const setToolbarOpen = useCallback(
    (open) => {
      if (snapshotSession && open) {
        // Reopening a dismissed snapshot toolbar is still a temporary reveal, not a user pin.
        setSnapshotToolbar((current) => ({ ...current, dismissed: false }));
        return;
      }
      toolbarOpenRef.current = open;
      setToolbarOpenState(open);
      if (!open) setSnapshotToolbar((current) => ({ ...current, dismissed: true }));
    },
    [snapshotSession]
  );

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
    // The editor is hidden while it may still hold focus, and may never report the blur.
    focusRef.current["dock-editor"] = false;
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
    // The entry reads as pressed whenever the header shows, so a click then always means Hide.
    if (
      toolbarOpenRef.current ||
      snapshotOpen ||
      editorViewRef.current !== null ||
      forceHeaderVisible
    ) {
      closeEditor();
      setToolbarOpen(false);
    } else {
      setToolbarOpen(true);
    }
  }, [closeEditor, forceHeaderVisible, setToolbarOpen, snapshotOpen]);
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
      // A held key repeats: closing an editor must not run on into closing the toolbar.
      if (event.key === "Escape" && !event.repeat && !event.defaultPrevented) dismiss();
    };
    // Dock can become active while this window already has focus; no focus event follows.
    focusRef.current.strip = document.hasFocus();
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
        headerVisible: nativeHeaderVisible,
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
    nativeHeaderVisible,
    onError,
  ]);

  return {
    headerVisible,
    headerPresentationId: presentation.id,
    confirmHeaderReady,
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
