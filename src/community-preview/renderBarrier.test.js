/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settleCommunityPreviewRender } from "./renderBarrier.js";

function immediateFrames() {
  return vi.fn((callback) => callback());
}

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
});

describe("Community preview render barrier", () => {
  it("settles a static scene on the third identical frame", async () => {
    document.body.innerHTML = "<p>Stats</p>";
    const requestFrame = immediateFrames();

    await expect(settleCommunityPreviewRender({ document, requestFrame })).resolves.toEqual({
      canvasCount: 0,
    });
    expect(requestFrame).toHaveBeenCalledTimes(3);
  });

  it("keeps waiting while a canvas is still being resized and redrawn", async () => {
    document.body.innerHTML = '<canvas width="686" height="422"></canvas>';
    const canvas = document.querySelector("canvas");
    // Drawn, drawn, cleared by the device-pixel resize, redrawn, then unchanged.
    const frames = ["first", "first", "", "final", "final", "final"];
    const requestFrame = vi.fn((callback) => {
      if (requestFrame.mock.calls.length === 3) canvas.height = 421;
      callback();
    });
    const readCanvas = vi.fn(() => frames[requestFrame.mock.calls.length - 1]);

    await expect(
      settleCommunityPreviewRender({ document, requestFrame, readCanvas })
    ).resolves.toEqual({ canvasCount: 1 });
    expect(requestFrame).toHaveBeenCalledTimes(6);
  });

  it("keeps waiting while the document is still changing", async () => {
    const requestFrame = vi.fn((callback) => {
      if (requestFrame.mock.calls.length <= 2) document.body.append("x");
      callback();
    });

    await settleCommunityPreviewRender({ document, requestFrame });
    expect(requestFrame).toHaveBeenCalledTimes(4);
  });

  it("refuses a scene that never stops changing", async () => {
    document.body.innerHTML = '<canvas width="10" height="10"></canvas>';
    let frame = 0;
    await expect(
      settleCommunityPreviewRender({
        document,
        requestFrame: immediateFrames(),
        readCanvas: () => String((frame += 1)),
        maxFrames: 20,
      })
    ).rejects.toThrow("did not settle");
  });

  it("refuses an unsettled canvas", async () => {
    document.body.innerHTML = '<canvas width="0" height="0"></canvas>';
    await expect(
      settleCommunityPreviewRender({
        document,
        requestFrame: immediateFrames(),
        readCanvas: () => "",
      })
    ).rejects.toThrow("did not settle");
  });
});
