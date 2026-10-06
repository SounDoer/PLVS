import {
  FrameDataProvider,
  HistoryDataProvider,
  MetricsDataProvider,
  PanelChromeProvider,
} from "./AudioDataContext.jsx";

/**
 * @param {{
 *   frameData: Partial<import("./AudioDataContext.jsx").FrameData>,
 *   historyData: Partial<import("./AudioDataContext.jsx").PanelHistoryData>,
 *   metricsData: Partial<import("./AudioDataContext.jsx").MetricsData>,
 *   panelChromeData: Partial<import("./AudioDataContext.jsx").PanelChromeData>,
 *   children: import("react").ReactNode,
 * }} props
 */
export function PanelDataProviders({
  frameData,
  historyData,
  metricsData,
  panelChromeData,
  children,
}) {
  return (
    <FrameDataProvider value={frameData}>
      <HistoryDataProvider value={historyData}>
        <MetricsDataProvider value={metricsData}>
          <PanelChromeProvider value={panelChromeData}>{children}</PanelChromeProvider>
        </MetricsDataProvider>
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}
