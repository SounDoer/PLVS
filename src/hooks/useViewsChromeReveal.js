import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";

export function useViewsChromeReveal({ autoHideControls, frameless }) {
  const [controlsVisible, setControlsVisible] = useState(false);
  const controlsHeldRef = useRef(false);
  const hideTimerRef = useRef(0);
  const dragTimerRef = useRef(0);

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
      const releaseAfterDrag = () => {
        releaseControlsHold();
        window.clearTimeout(dragTimerRef.current);
      };
      try {
        holdControls(true);
        window.addEventListener("pointerup", releaseAfterDrag, { once: true, capture: true });
        window.addEventListener("pointercancel", releaseAfterDrag, { once: true, capture: true });
        window.addEventListener("mouseup", releaseAfterDrag, { once: true, capture: true });
        window.addEventListener("blur", releaseAfterDrag, { once: true });
        dragTimerRef.current = window.setTimeout(releaseAfterDrag, 10000);
        const win = getCurrentWindow();
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
