import { createContext, useContext } from "react";

/**
 * Provides all audio-domain data and callbacks to module components,
 * eliminating prop-drilling through Dock / Region / Slot layers.
 *
 * Shape matches the values currently computed in App.jsx and passed
 * through the split layout. Module components consume shared data via
 * useSharedPanelData() and per-panel controls/status via usePanelInstanceData().
 */
export const AudioDataContext = createContext(null);
const PanelInstanceContext = createContext(null);
const PanelChromeContext = createContext(null);

export function PanelChromeProvider({ value, children }) {
  return <PanelChromeContext.Provider value={value}>{children}</PanelChromeContext.Provider>;
}

export function usePanelChromeData() {
  return useContext(PanelChromeContext);
}

export function PanelInstanceProvider({ value, children }) {
  return <PanelInstanceContext.Provider value={value}>{children}</PanelInstanceContext.Provider>;
}

export function useSharedPanelData() {
  return useContext(AudioDataContext);
}

export function usePanelInstanceData() {
  return useContext(PanelInstanceContext);
}
