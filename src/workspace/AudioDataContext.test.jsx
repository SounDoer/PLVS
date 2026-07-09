/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  PanelChromeProvider,
  PanelInstanceProvider,
  useFrameData,
  useHistoryData,
  useMetricsData,
  usePanelInstanceData,
  usePanelChromeData,
} from "./AudioDataContext.jsx";
import { PanelDataProviders } from "./PanelDataProviders.jsx";

describe("panel instance data seam", () => {
  it("exposes frame, history, and metrics data independently", () => {
    const frame = {
      displayAudio: { momentary: -18 },
      spectrumChannelOptions: [{ key: "p-0-1", label: "L/R" }],
    };
    const history = {
      selectedOffset: -1,
      historyTimeTicks: ["0s", "30s"],
    };
    const metrics = {
      statsMetrics: [{ id: "momentary", value: "-18.0" }],
      dialogueActiveNow: true,
    };
    const onPanelControlsChange = vi.fn();
    const wrapper = ({ children }) => (
      <PanelDataProviders frameData={frame} historyData={history} metricsData={metrics}>
        <PanelInstanceProvider
          value={{
            panelControls: { spectrumView: "midSide" },
            onPanelControlsChange,
            analysisStatus: "overCap",
            panelVisible: false,
          }}
        >
          {children}
        </PanelInstanceProvider>
      </PanelDataProviders>
    );

    const { result } = renderHook(
      () => ({
        frame: useFrameData(),
        history: useHistoryData(),
        metrics: useMetricsData(),
      }),
      { wrapper }
    );

    expect(result.current.frame).toBe(frame);
    expect(result.current.history).toBe(history);
    expect(result.current.metrics).toBe(metrics);
    expect(result.current.frame.selectedOffset).toBeUndefined();
    expect(result.current.history.displayAudio).toBeUndefined();
    expect(result.current.metrics.panelControls).toBeUndefined();
  });

  it("exposes panel instance data independently", () => {
    const frame = {
      displayAudio: { momentary: -18 },
      spectrumChannelOptions: [{ key: "p-0-1", label: "L/R" }],
    };
    const onPanelControlsChange = vi.fn();
    const wrapper = ({ children }) => (
      <PanelDataProviders frameData={frame} historyData={{}} metricsData={{}}>
        <PanelInstanceProvider
          value={{
            panelControls: { spectrumView: "midSide" },
            onPanelControlsChange,
            analysisStatus: "overCap",
            panelVisible: false,
          }}
        >
          {children}
        </PanelInstanceProvider>
      </PanelDataProviders>
    );

    const { result } = renderHook(() => usePanelInstanceData(), { wrapper });

    expect(result.current.panelControls).toEqual({ spectrumView: "midSide" });
    expect(result.current.onPanelControlsChange).toBe(onPanelControlsChange);
    expect(result.current.analysisStatus).toBe("overCap");
    expect(result.current.panelVisible).toBe(false);
    expect(result.current.displayAudio).toBeUndefined();
  });

  it("supplies low-frequency workspace chrome independently", () => {
    const chrome = { compactPanels: true, channelCount: 6 };
    const wrapper = ({ children }) => (
      <PanelChromeProvider value={chrome}>{children}</PanelChromeProvider>
    );

    const { result } = renderHook(() => usePanelChromeData(), { wrapper });

    expect(result.current).toBe(chrome);
  });

  it("composes frame, history, metrics, and chrome providers for panel modules", () => {
    const frame = { displayAudio: { momentary: -18 } };
    const history = { selectedOffset: -1 };
    const metrics = { statsMetrics: [] };
    const chrome = { compactPanels: true, channelCount: 6 };
    const wrapper = ({ children }) => (
      <PanelDataProviders
        frameData={frame}
        historyData={history}
        metricsData={metrics}
        panelChromeData={chrome}
      >
        {children}
      </PanelDataProviders>
    );

    const { result } = renderHook(
      () => ({
        frame: useFrameData(),
        history: useHistoryData(),
        metrics: useMetricsData(),
        chrome: usePanelChromeData(),
      }),
      { wrapper }
    );

    expect(result.current.frame).toBe(frame);
    expect(result.current.history).toBe(history);
    expect(result.current.metrics).toBe(metrics);
    expect(result.current.chrome).toBe(chrome);
  });
});
