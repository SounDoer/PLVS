import { createContext, useContext, useLayoutEffect, useMemo, useRef } from "react";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts.js";
import { useSettings } from "../hooks/useSettings.js";

const SettingsContext = createContext(/** @type {ReturnType<typeof useSettings> | null} */ (null));
const ShortcutSettingsContext = createContext(
  /** @type {ReturnType<typeof useKeyboardShortcuts> | null} */ (null)
);

export function SettingsProvider({ children }) {
  return <SettingsContext.Provider value={useSettings()}>{children}</SettingsContext.Provider>;
}

/** Native registration outlives individual callbacks, so it reads the latest committed action. */
export function ShortcutSettingsProvider({ dispatchShortcut, children }) {
  const dispatch = useRef(dispatchShortcut);
  useLayoutEffect(() => {
    dispatch.current = dispatchShortcut;
  }, [dispatchShortcut]);
  const shortcuts = useKeyboardShortcuts(dispatch);
  return (
    <ShortcutSettingsContext.Provider value={shortcuts}>
      {children}
    </ShortcutSettingsContext.Provider>
  );
}

export function useAppSettings() {
  const settings = useContext(SettingsContext);
  const shortcuts = useContext(ShortcutSettingsContext);
  const combined = useMemo(() => ({ ...settings, ...shortcuts }), [settings, shortcuts]);
  if (!settings) throw new Error("useAppSettings must be used inside SettingsProvider");
  return combined;
}
