/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AudioDataContext,
  PanelChromeProvider,
  PanelInstanceProvider,
  usePanelInstanceData,
  usePanelChromeData,
  useSharedPanelData,
} from "./AudioDataContext.jsx";
import { PanelDataProviders } from "./PanelDataProviders.jsx";

describe("panel instance data seam", () => {
  it("exposes shared panel data without panel instance fields", () => {
    const base = {
      displayAudio: { momentary: -18 },
      spectrumChannelOptions: [{ key: "p-0-1", label: "L/R" }],
    };
    const onPanelControlsChange = vi.fn();
    const wrapper = ({ children }) => (
      <AudioDataContext.Provider value={base}>
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
      </AudioDataContext.Provider>
    );

    const { result } = renderHook(() => useSharedPanelData(), { wrapper });

    expect(result.current.displayAudio).toBe(base.displayAudio);
    expect(result.current.spectrumChannelOptions).toBe(base.spectrumChannelOptions);
    expect(result.current.panelControls).toBeUndefined();
    expect(result.current.onPanelControlsChange).toBeUndefined();
    expect(result.current.analysisStatus).toBeUndefined();
    expect(result.current.analysisStatusByPanelId).toBeUndefined();
    expect(result.current.panelVisible).toBeUndefined();
    expect(result.current.compactPanels).toBeUndefined();
  });

  it("exposes panel instance data independently", () => {
    const base = {
      displayAudio: { momentary: -18 },
      spectrumChannelOptions: [{ key: "p-0-1", label: "L/R" }],
    };
    const onPanelControlsChange = vi.fn();
    const wrapper = ({ children }) => (
      <AudioDataContext.Provider value={base}>
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
      </AudioDataContext.Provider>
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

  it("composes shared and chrome providers for panel modules", () => {
    const shared = { displayAudio: { momentary: -18 } };
    const chrome = { compactPanels: true, channelCount: 6 };
    const wrapper = ({ children }) => (
      <PanelDataProviders sharedPanelData={shared} panelChromeData={chrome}>
        {children}
      </PanelDataProviders>
    );

    const { result } = renderHook(
      () => ({
        shared: useSharedPanelData(),
        chrome: usePanelChromeData(),
      }),
      { wrapper }
    );

    expect(result.current.shared).toBe(shared);
    expect(result.current.chrome).toBe(chrome);
  });
});
