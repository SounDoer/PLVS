import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";

const DOUBLE_PRESS_MAX_DELAY_MS = 500;
const DOUBLE_PRESS_MAX_DISTANCE_PX = 8;

export function useViewsChromeReveal({ autoHideControls, frameless }) {
  const [controlsVisible, setControlsVisible] = useState(false);
  const controlsHeldRef = useRef(false);
  const hideTimerRef = useRef(0);
  const dragTimerRef = useRef(0);
  const lastDragPressRef = useRef(null);

  const showControls = useCallback(() => {
    window.clearTimeout(hideTimerRef.current);
    setControlsVisible(true);
  }, []);

  const hideControlsLater = useCallback(() => {
    if (controlsHeldRef.current) return;
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 900);
  }, []);

  const hideControlsNow = useCallback(() => {
    if (controlsHeldRef.current) return;
    window.clearTimeout(hideTimerRef.current);
    setControlsVisible(false);
  }, []);

  const toggleControls = useCallback(() => {
    if (controlsVisible) {
      hideControlsNow();
    } else {
      showControls();
      hideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    }
  }, [controlsVisible, hideControlsNow, showControls]);

  const holdControls = useCallback((open) => {
    controlsHeldRef.current = open;
    if (open) {
      window.clearTimeout(hideTimerRef.current);
      setControlsVisible(true);
    }
  }, []);

  const releaseControlsHold = useCallback(() => {
    controlsHeldRef.current = false;
  }, []);

  const handleWindowDrag = useCallback(
    async (event) => {
      if (!frameless || event.button !== 0 || event.target !== event.currentTarget) return;
      if (!isTauri()) return;
      // `releaseAfterDrag` is rebuilt per gesture, so the browser cannot dedupe these against
      // an earlier drag's registrations, and `once: true` only removes a listener that actually
      // fires. Once `startDragging` hands the gesture to the OS the webview usually never sees
      // pointerup at all -- which is why the timeout below exists -- so without an explicit
      // teardown every drag stranded up to four listeners plus their closures on `window`.
      const dragListeners = new AbortController();
      const releaseAfterDrag = () => {
        releaseControlsHold();
        window.clearTimeout(dragTimerRef.current);
        dragListeners.abort();
      };
      try {
        const win = getCurrentWindow();
        const press = {
          target: event.currentTarget,
          timeStamp: event.timeStamp,
          x: event.clientX,
          y: event.clientY,
        };
        const previousPress = lastDragPressRef.current;
        const isNearbyRepeat =
          previousPress !== null &&
          previousPress.target === press.target &&
          press.timeStamp >= previousPress.timeStamp &&
          press.timeStamp - previousPress.timeStamp <= DOUBLE_PRESS_MAX_DELAY_MS &&
          Math.abs(press.x - previousPress.x) <= DOUBLE_PRESS_MAX_DISTANCE_PX &&
          Math.abs(press.y - previousPress.y) <= DOUBLE_PRESS_MAX_DISTANCE_PX;
        const isDoublePress = event.detail === 2 || isNearbyRepeat;
        lastDragPressRef.current = isDoublePress ? null : press;
        if (isDoublePress) {
          if (typeof win.toggleMaximize === "function") await win.toggleMaximize();
          return;
        }
        holdControls(true);
        const signal = dragListeners.signal;
        window.addEventListener("pointerup", releaseAfterDrag, {
          once: true,
          capture: true,
          signal,
        });
        window.addEventListener("pointercancel", releaseAfterDrag, {
          once: true,
          capture: true,
          signal,
        });
        window.addEventListener("mouseup", releaseAfterDrag, { once: true, capture: true, signal });
        window.addEventListener("blur", releaseAfterDrag, { once: true, signal });
        dragTimerRef.current = window.setTimeout(releaseAfterDrag, 10000);
        if (typeof win.startDragging === "function") await win.startDragging();
      } catch (_) {
        releaseAfterDrag();
      }
    },
    [frameless, holdControls, releaseControlsHold]
  );

  useEffect(() => {
    if (autoHideControls) return undefined;
    window.clearTimeout(hideTimerRef.current);
    controlsHeldRef.current = false;
    const resetTimer = window.setTimeout(() => {
      setControlsVisible(false);
    }, 0);
    return () => window.clearTimeout(resetTimer);
  }, [autoHideControls]);

  useEffect(
    () => () => {
      window.clearTimeout(hideTimerRef.current);
      window.clearTimeout(dragTimerRef.current);
    },
    []
  );

  return {
    controlsVisible: autoHideControls ? controlsVisible : false,
    showControls,
    hideControlsLater,
    hideControlsNow,
    toggleControls,
    holdControls,
    releaseControlsHold,
    handleWindowDrag,
  };
}
