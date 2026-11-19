import { useEffect, useRef } from "react";
import { eventMatchesAccelerator, reservedAcceleratorLabel } from "../lib/accelerator.js";

export function useAppKeyboardShortcuts({
  dispatchShortcutAction,
  canClear,
  keyboardShortcuts,
  shortcutCapturing,
  autoHideControls,
  toggleFocusControls,
}) {
  const shortcutHandlerRef = useRef({
    dispatchShortcutAction,
    canClear,
    keyboardShortcuts,
    shortcutCapturing,
    autoHideControls,
    toggleFocusControls,
  });

  useEffect(() => {
    shortcutHandlerRef.current = {
      dispatchShortcutAction,
      canClear,
      keyboardShortcuts,
      shortcutCapturing,
      autoHideControls,
      toggleFocusControls,
    };
  }, [
    autoHideControls,
    dispatchShortcutAction,
    keyboardShortcuts,
    canClear,
    shortcutCapturing,
    toggleFocusControls,
  ]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented) return;
      const {
        dispatchShortcutAction: dispatch,
        canClear: clearAvailable,
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
        : Object.entries(bindings ?? {}).find(
            ([, binding]) =>
              binding.accelerator &&
              !reservedAcceleratorLabel(binding.accelerator) &&
              eventMatchesAccelerator(e, binding.accelerator)
          )?.[0];
      if (configuredAction) {
        e.preventDefault();
        if (e.repeat) return;
        if (configuredAction !== "clear" || clearAvailable) dispatch(configuredAction);
        return;
      }
      if (e.key === "Escape" && autoHide && !editable) {
        e.preventDefault();
        toggleFocus();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
