import { createContext, useContext, useRef } from "react";
import { useSettings } from "../hooks/useSettings.js";

/**
 * @typedef {ReturnType<typeof useSettings> & {
 *   onClearRef: import("react").MutableRefObject<(() => any) | null>,
 * }} AppSettings
 */
const SettingsContext = createContext(/** @type {AppSettings | null} */ (null));

/**
 * The one mount of `useSettings`: every stored preference, including the view values the Dock
 * restores and the window chrome applies.
 *
 * `onClearRef` is the single link that points inward. The clear shortcut is a setting, registered
 * here; the action it triggers belongs to the source actions, which mount far inside and assign the
 * ref during render. A ref rather than a context read, because this provider cannot read one it
 * encloses.
 */
export function SettingsProvider({ children }) {
  const onClearRef = useRef(/** @type {(() => any) | null} */ (null));
  const settings = useSettings({ onClearRef });
  return (
    <SettingsContext.Provider value={{ ...settings, onClearRef }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useAppSettings() {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error("useAppSettings must be used inside SettingsProvider");
  return settings;
}
