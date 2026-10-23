import { useEffect, useRef } from "react";
import { eventMatchesAccelerator } from "../lib/accelerator.js";

export function useAppKeyboardShortcuts({
  dispatchShortcutAction,
  running,
  showClock,
  setSettingsOpen,
  keyboardShortcuts,
  shortcutCapturing,
  autoHideControls,
  toggleFocusControls,
}) {
  const shortcutHandlerRef = useRef({
    dispatchShortcutAction,
    running,
    showClock,
    setSettingsOpen,
    keyboardShortcuts,
    shortcutCapturing,
    autoHideControls,
    toggleFocusControls,
  });

  useEffect(() => {
    shortcutHandlerRef.current = {
      dispatchShortcutAction,
      running,
      showClock,
      setSettingsOpen,
      keyboardShortcuts,
      shortcutCapturing,
      autoHideControls,
      toggleFocusControls,
    };
  }, [
    autoHideControls,
    dispatchShortcutAction,
    keyboardShortcuts,
    running,
    setSettingsOpen,
    showClock,
    shortcutCapturing,
    toggleFocusControls,
  ]);

  useEffect(() => {
    const onKeyDown = (e) => {
      const {
        dispatchShortcutAction: dispatch,
        running: isRunning,
        showClock: hasClock,
        setSettingsOpen: openSettings,
        keyboardShortcuts: bindings,
        shortcutCapturing: isCapturing,
        autoHideControls: autoHide,
        toggleFocusControls: toggleFocus,
      } = shortcutHandlerRef.current;
      const tag = document.activeElement?.tagName ?? "";
      const editable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        /** @type {HTMLElement | null} */ (document.activeElement)?.isContentEditable;
      const configuredAction = isCapturing
        ? null
        : Object.entries(bindings ?? {}).find(([, binding]) =>
            binding.accelerator ? eventMatchesAccelerator(e, binding.accelerator) : false
          )?.[0];
      if (configuredAction) {
        e.preventDefault();
        if (e.repeat) return;
        if (configuredAction !== "clear" || isRunning || hasClock) dispatch(configuredAction);
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
