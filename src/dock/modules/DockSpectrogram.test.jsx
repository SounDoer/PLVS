import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCanvasSize } from "../../hooks/useCanvasSize.js";
import { useSpectrogramCanvas } from "../../hooks/useSpectrogramCanvas.js";
import { FrameDataProvider, HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { dockSpectrumKey } from "../dockAnalysisRequest.js";
import { DockSpectrogram } from "./DockSpectrogram.jsx";

vi.mock("../../hooks/useCanvasSize.js", () => ({ useCanvasSize: vi.fn() }));
vi.mock("../../hooks/useSpectrogramCanvas.js", () => ({ useSpectrogramCanvas: vi.fn() }));

function makeSnaps(list) {
  return {
    length: list.length,
    version: list.length,
    rowAt: (index) => list[index],
    timestampAt: (index) => list[index]?.timestampMs ?? NaN,
  };
}

function renderWith({ controls, snaps }) {
  const getSpectrogramSnapsForKey = vi.fn(() => snaps);
  const utils = render(
    <FrameDataProvider value={{ resolvedThemeId: "dark" }}>
      <HistoryDataProvider value={{ getSpectrogramSnapsForKey }}>
        <DockSpectrogram controls={controls} />
      </HistoryDataProvider>
    </FrameDataProvider>
  );
  return { ...utils, getSpectrogramSnapsForKey };
}

describe("DockSpectrogram", () => {
  beforeEach(() => {
    vi.mocked(useCanvasSize).mockClear();
    vi.mocked(useSpectrogramCanvas).mockClear();
  });

  it("uses a responsive 1x canvas and the shared normal-panel painter", () => {
    const controls = {
      panelId: "spectrogram-1",
      channel: { type: "pair", x: 0, y: 1 },
      minFreq: 100,
      maxFreq: 8000,
      dockHistoryWindowSec: 60,
    };
    const snaps = makeSnaps([
      {
        timestampMs: 1000,
        dbList: [-40, -50, -60],
        bands: [{ fCenter: 40 }, { fCenter: 400 }, { fCenter: 4000 }],
      },
    ]);
    const { container, getSpectrogramSnapsForKey } = renderWith({ controls, snaps });

    expect(container.querySelector("canvas")).not.toBeNull();
    expect(useCanvasSize).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined, {
      maxDevicePixelRatio: 1,
    });
    expect(getSpectrogramSnapsForKey).toHaveBeenCalledWith(dockSpectrumKey(controls));
    expect(useSpectrogramCanvas).toHaveBeenCalledWith(
      expect.objectContaining({
        oldestMs: 1040 - 60_000,
        newestMs: 1040,
        minHz: 100,
        maxHz: 8000,
        selectedOffset: -1,
      })
    );
  });

  it("renders an empty responsive canvas without history", () => {
    const controls = { channel: { type: "pair", x: 0, y: 1 }, dockHistoryWindowSec: 60 };
    const { container } = renderWith({ controls, snaps: makeSnaps([]) });
    const args = vi.mocked(useSpectrogramCanvas).mock.calls.at(-1)[0];

    expect(container.querySelector("canvas")).not.toBeNull();
    expect(args.oldestMs).toBeNaN();
    expect(args.newestMs).toBeNaN();
  });
});
