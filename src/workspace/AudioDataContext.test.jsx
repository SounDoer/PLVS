/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AudioDataContext,
  PanelChromeProvider,
  PanelInstanceProvider,
  useAudioData,
  usePanelChromeData,
} from "./AudioDataContext.jsx";

describe("panel instance data seam", () => {
  it("adds panel-scoped controls without replacing shared audio data", () => {
    const base = {
      displayAudio: { momentary: -18 },
      panelControls: { spectrumView: "combined" },
      analysisStatusByPanelId: { spectrumA: "overCap" },
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

    const { result } = renderHook(() => useAudioData(), { wrapper });

    expect(result.current.displayAudio).toBe(base.displayAudio);
    expect(result.current.panelControls).toEqual({ spectrumView: "midSide" });
    expect(result.current.onPanelControlsChange).toBe(onPanelControlsChange);
    expect(result.current.analysisStatus).toBe("overCap");
    expect(result.current.panelVisible).toBe(false);
  });

  it("supplies low-frequency workspace chrome independently", () => {
    const chrome = { compactPanels: true, channelCount: 6 };
    const wrapper = ({ children }) => (
      <PanelChromeProvider value={chrome}>{children}</PanelChromeProvider>
    );

    const { result } = renderHook(() => usePanelChromeData(), { wrapper });

    expect(result.current).toBe(chrome);
  });
});
