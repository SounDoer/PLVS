/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { settleCommunityPreviewRender } from "./renderBarrier.js";

describe("Community preview render barrier", () => {
  it("waits for fonts and exactly two animation frames", async () => {
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
    const requestFrame = vi.fn((callback) => callback());

    await expect(settleCommunityPreviewRender({ document, requestFrame })).resolves.toEqual({
      canvasCount: 0,
    });
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it("refuses an unsettled canvas", async () => {
    document.body.innerHTML = '<canvas width="0" height="0"></canvas>';
    await expect(
      settleCommunityPreviewRender({ document, requestFrame: (callback) => callback() })
    ).rejects.toThrow("did not settle");
  });
});
