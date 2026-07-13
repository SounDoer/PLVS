import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FrameDataProvider, HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockSpectrogram } from "./DockSpectrogram.jsx";

// jsdom has no real canvas 2D context (getContext returns undefined and logs a
// "not implemented" error). Stub it for the happy-path test so the paint effect
// runs far enough to read snaps; the "missing snaps" test relies on jsdom's real
// (null) getContext to exercise the graceful no-op path.
function stubCanvasContext() {
  return vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect: vi.fn(),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: vi.fn(),
  });
}

function makeSnaps(list) {
  return {
    length: list.length,
    rowAt: (i) => list[i],
  };
}

function renderWith({ snaps }) {
  const getSpectrogramSnapsForKey = vi.fn(() => snaps);
  const utils = render(
    <FrameDataProvider value={{ resolvedThemeId: "dark" }}>
      <HistoryDataProvider value={{ getSpectrogramSnapsForKey }}>
        <DockSpectrogram />
      </HistoryDataProvider>
    </FrameDataProvider>
  );
  return { ...utils, getSpectrogramSnapsForKey };
}

describe("DockSpectrogram", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a canvas and reads snaps for the dock key", () => {
    stubCanvasContext();
    const snap = {
      timestampMs: 1000,
      dbList: [-40, -50, -60],
      bands: [{ fCenter: 40 }, { fCenter: 400 }, { fCenter: 4000 }],
    };
    const { container, getSpectrogramSnapsForKey } = renderWith({
      snaps: makeSnaps([snap]),
    });
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(getSpectrogramSnapsForKey).toHaveBeenCalled();
  });

  it("tolerates a missing snaps source (renders empty canvas)", () => {
    const { container } = renderWith({ snaps: undefined });
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
