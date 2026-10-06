import {
  FrameDataProvider,
  HistoryDataProvider,
  MetricsDataProvider,
  PanelChromeProvider,
} from "./AudioDataContext.jsx";

/**
 * @param {{
 *   frameData: any,
 *   historyData: any,
 *   metricsData: any,
 *   panelChromeData: any,
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
