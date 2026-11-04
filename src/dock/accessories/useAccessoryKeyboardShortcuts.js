import { useAppKeyboardShortcuts } from "../../hooks/useAppKeyboardShortcuts.js";

/** Reuse the ordinary keyboard interpreter without registering another native shortcut owner. */
export function useAccessoryKeyboardShortcuts(keyboard, action) {
  useAppKeyboardShortcuts({
    dispatchShortcutAction: (actionId) => action("keyboard-shortcut", { actionId }),
    running: keyboard?.running ?? false,
    showClock: keyboard?.showClock ?? false,
    setSettingsOpen: () => action("open-settings"),
    keyboardShortcuts: keyboard?.bindings ?? {},
    shortcutCapturing: keyboard?.capturing ?? false,
    autoHideControls: false,
    toggleFocusControls: () => {},
  });
}
