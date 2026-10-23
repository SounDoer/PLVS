import { createContext, useContext, useRef } from "react";
import { useSettings } from "../hooks/useSettings.js";

/**
 * @typedef {ReturnType<typeof useSettings> & {
 *   onClearRef: import("react").MutableRefObject<(() => any) | null>,
 *   shortcutActionRef: import("react").MutableRefObject<((actionId: string) => any) | null>,
 *   onHistoryRetentionChangeRef: import("react").MutableRefObject<(() => any) | null>,
 * }} AppSettings
 */
const SettingsContext = createContext(/** @type {AppSettings | null} */ (null));

/**
 * The one mount of `useSettings`: every stored preference, including the view values the Dock
 * restores and the window chrome applies.
 *
 * The action refs point inward. Shortcut registration is a setting owned here; the actions belong
 * to the source-actions provider mounted farther inside. Refs avoid making this outer provider read
 * a context it encloses. `onClearRef` remains the focused whole-measurement restart link used by
 * other Settings effects.
 */
export function SettingsProvider({ children }) {
  const onClearRef = useRef(/** @type {(() => any) | null} */ (null));
  const shortcutActionRef = useRef(/** @type {((actionId: string) => any) | null} */ (null));
  const onHistoryRetentionChangeRef = useRef(/** @type {(() => any) | null} */ (null));
  const settings = useSettings({ shortcutActionRef, onHistoryRetentionChangeRef });
  return (
    <SettingsContext.Provider
      value={{ ...settings, onClearRef, shortcutActionRef, onHistoryRetentionChangeRef }}
    >
      {children}
    </SettingsContext.Provider>
  );
}

export function useAppSettings() {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error("useAppSettings must be used inside SettingsProvider");
  return settings;
}
