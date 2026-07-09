import { useEffect, useRef } from "react";
import { eventMatchesAccelerator } from "../lib/accelerator.js";

export function useAppKeyboardShortcuts({
  clearAll,
  running,
  showClock,
  setSettingsOpen,
  clearShortcut,
  autoHideControls,
  toggleFocusControls,
}) {
  const shortcutHandlerRef = useRef({
    clearAll,
    running,
    showClock,
    setSettingsOpen,
    clearShortcut,
    autoHideControls,
    toggleFocusControls,
  });

  useEffect(() => {
    shortcutHandlerRef.current = {
      clearAll,
      running,
      showClock,
      setSettingsOpen,
      clearShortcut,
      autoHideControls,
      toggleFocusControls,
    };
  }, [
    autoHideControls,
    clearAll,
    clearShortcut,
    running,
    setSettingsOpen,
    showClock,
    toggleFocusControls,
  ]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const {
        clearAll: clear,
        running: isRunning,
        showClock: hasClock,
        setSettingsOpen: openSettings,
        clearShortcut: clearCombo,
        autoHideControls: autoHide,
        toggleFocusControls: toggleFocus,
      } = shortcutHandlerRef.current;
      const tag = document.activeElement?.tagName ?? "";
      const editable =
        tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;
      if (eventMatchesAccelerator(e, clearCombo)) {
        e.preventDefault();
        if (isRunning || hasClock) clear();
        return;
      }
      if (e.key === "Escape" && autoHide && !editable) {
        e.preventDefault();
        toggleFocus();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openSettings(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
