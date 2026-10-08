import { createContext, useContext } from "react";

/**
 * Provides panel data by update domain, eliminating prop-drilling through
 * Dock / Region / Slot layers while keeping each panel's dependencies explicit.
 */
// The four shapes below are what App builds. The providers take a partial one because the Dock, the
// community preview and the tests each mount only the panels they need and supply only what those
// read; a consumer is typed as if it had the whole thing, which is how every panel is written.

/**
 * What changes every audio frame: the live readings and the facts needed to label them.
 *
 * @typedef {{
 *   displayAudio: any,
 *   hasTpMaxValue: boolean,
 *   onResetTpMax: (...args: any[]) => any,
 *   vsGridDiagInset: number,
 *   vsGridDiagFar: number,
 *   correlation: any,
 *   vectorscopePairX: number,
 *   vectorscopePairY: number,
 *   channelCount: any,
 *   peakLabelContext: any,
 *   resolvedThemeId: string,
 *   spectrumChannelOptions: any,
 * }} FrameData
 */

/**
 * The retained history and the shared time viewport over it, with the gesture handlers that
 * move that viewport.
 *
 * @typedef {{
 *   selectedOffset: any,
 *   setSelectedOffset: any,
 *   selectSnapshot: any,
 *   sourceMode: any,
 *   historyMaxWindowSec: any,
 *   historyWindowSec: number,
 *   historyOffsetSec: number,
 *   setHistoryWindowSec: (...args: any[]) => any,
 *   setHistoryOffsetSec: (...args: any[]) => any,
 *   running: any,
 *   referenceLufs: number,
 *   momentaryRules: any,
 *   shortTermRules: any,
 *   hasHistoryData: boolean,
 *   historyChartInteractive: any,
 *   captureCurrentSnapshot: (...args: any[]) => any,
 *   frequencyMarkerRef: any,
 *   frequencyMarkerIndex: any,
 *   totalSamples: any,
 *   histSourceList: any,
 *   loudnessDisplayIndex: any,
 *   waveformHistoryIndex: any,
 *   visualWaveformHist: any,
 *   snapshotSpectrumByKey: any,
 *   resolveSpectrumSnapshotForKey: (...args: any[]) => any,
 *   resolveVectorscopeSnapshotForKey: (...args: any[]) => any,
 *   resolveStereoMapSnapshotForKey: (...args: any[]) => any,
 *   getVectorscopeHistoryForKey: (...args: any[]) => any,
 *   getStereoMapHistoryForKey: (...args: any[]) => any,
 *   vectorscopeResetEpoch: number,
 *   stereoMapResetEpoch: number,
 *   getSpectrogramSnapsForKey: any,
 * }} HistoryData
 */

/**
 * Derived readouts that change slower than a frame.
 *
 * @typedef {{
 *   statsMetrics: any,
 *   dialogueActiveNow: any,
 * }} MetricsData
 */

/**
 * What a panel's header and settings popover need that is not the panel's own.
 *
 * @typedef {{
 *   compactPanels: boolean,
 *   channelCount: any,
 *   vectorscopePairOptions: { x: number; y: number; label: string; key: string; }[],
 *   stereoMapPairOptions: { x: number; y: number; label: string; key: string; }[],
 *   stereoMapPairDisplayLabel: any,
 *   spectrumChannelOptions: any,
 *   spectrumViewLegend: { token: "primary" | "secondary"; label: string; }[],
 * }} PanelChromeData
 */

/**
 * What `usePanelHistoryData` adds for a panel with a time axis: the viewport resolved to
 * samples, the selection line, the HUD and the gesture handlers.
 *
 * @typedef {{
 *   selectedHistSteps: number,
 *   showSelLine: boolean,
 *   selectionEdge: string,
 *   selLineX: number,
 *   isHistoryHudVisible: boolean,
 *   historyTimeTicks: string[],
 *   holdHistoryHud: (...args: any[]) => any,
 *   showHistoryHud: (...args: any[]) => any,
 *   onHistoryPointerDown: (...args: any[]) => any,
 *   onHistoryPointerMove: (...args: any[]) => any,
 *   onHistoryPointerUp: (...args: any[]) => any,
 *   onHistoryWheel: (...args: any[]) => any,
 *   historyTimeAxisHandlers: any,
 *   historyTimeAxisActive: boolean,
 *   clampedWindowSec: number,
 *   windowSamples: number,
 *   visibleSamples: number,
 *   maxOffsetSamples: number,
 *   effectiveOffsetSamples: number,
 *   effectiveOffsetSec: number,
 * }} PanelHistoryExtras
 */

/**
 * History as a panel reads it: the shared history, plus the panel-level part when the panel has a
 * time axis (or when a provider such as the Dock supplies the same fields itself).
 * @typedef {HistoryData & Partial<PanelHistoryExtras>} PanelHistoryData
 */

const FrameDataContext = createContext(/** @type {FrameData | null} */ (null));
const HistoryDataContext = createContext(/** @type {PanelHistoryData | null} */ (null));
const MetricsDataContext = createContext(/** @type {MetricsData | null} */ (null));
// A panel instance may carry a history of its own (a file session); the rest of what it holds is
// typed where the instance value is built.
const PanelInstanceContext = createContext(
  /** @type {{ historyData?: PanelHistoryData, [key: string]: any } | null} */ (null)
);
const PanelChromeContext = createContext(/** @type {PanelChromeData | null} */ (null));

/** @param {{ value: Partial<FrameData>, children?: import("react").ReactNode }} props */
export function FrameDataProvider({ value, children }) {
  return (
    <FrameDataContext.Provider value={/** @type {FrameData} */ (value)}>
      {children}
    </FrameDataContext.Provider>
  );
}

export function useFrameData() {
  return useContext(FrameDataContext);
}

/** @param {{ value: Partial<PanelHistoryData>, children?: import("react").ReactNode }} props */
export function HistoryDataProvider({ value, children }) {
  return (
    <HistoryDataContext.Provider value={/** @type {PanelHistoryData} */ (value)}>
      {children}
    </HistoryDataContext.Provider>
  );
}

export function useHistoryData() {
  const globalHistoryData = useContext(HistoryDataContext);
  const panelInstanceData = useContext(PanelInstanceContext);
  return panelInstanceData?.historyData ?? globalHistoryData;
}

/** @param {{ value: Partial<MetricsData>, children?: import("react").ReactNode }} props */
export function MetricsDataProvider({ value, children }) {
  return (
    <MetricsDataContext.Provider value={/** @type {MetricsData} */ (value)}>
      {children}
    </MetricsDataContext.Provider>
  );
}

export function useMetricsData() {
  return useContext(MetricsDataContext);
}

/** @param {{ value: Partial<PanelChromeData>, children?: import("react").ReactNode }} props */
export function PanelChromeProvider({ value, children }) {
  return (
    <PanelChromeContext.Provider value={/** @type {PanelChromeData} */ (value)}>
      {children}
    </PanelChromeContext.Provider>
  );
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
