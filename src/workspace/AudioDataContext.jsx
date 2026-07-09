import { createContext, useContext } from "react";

/**
 * Provides panel data by update domain, eliminating prop-drilling through
 * Dock / Region / Slot layers while keeping each panel's dependencies explicit.
 */
const FrameDataContext = createContext(null);
const HistoryDataContext = createContext(null);
const MetricsDataContext = createContext(null);
const PanelInstanceContext = createContext(null);
const PanelChromeContext = createContext(null);

export function FrameDataProvider({ value, children }) {
  return <FrameDataContext.Provider value={value}>{children}</FrameDataContext.Provider>;
}

export function useFrameData() {
  return useContext(FrameDataContext);
}

export function HistoryDataProvider({ value, children }) {
  return <HistoryDataContext.Provider value={value}>{children}</HistoryDataContext.Provider>;
}

export function useHistoryData() {
  return useContext(HistoryDataContext);
}

export function MetricsDataProvider({ value, children }) {
  return <MetricsDataContext.Provider value={value}>{children}</MetricsDataContext.Provider>;
}

export function useMetricsData() {
  return useContext(MetricsDataContext);
}

export function PanelChromeProvider({ value, children }) {
  return <PanelChromeContext.Provider value={value}>{children}</PanelChromeContext.Provider>;
}

export function usePanelChromeData() {
  return useContext(PanelChromeContext);
}

export function PanelInstanceProvider({ value, children }) {
  return <PanelInstanceContext.Provider value={value}>{children}</PanelInstanceContext.Provider>;
}

export function usePanelInstanceData() {
  return useContext(PanelInstanceContext);
}
