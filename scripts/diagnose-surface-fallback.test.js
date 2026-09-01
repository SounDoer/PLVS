import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { compareCanvasScreenshots } from "./diagnose-surface-fallback.mjs";

describe("compareCanvasScreenshots", () => {
  it("compares the composited canvas region in viewport coordinates", async () => {
    const width = 8;
    const height = 8;
    const first = Buffer.alloc(width * height * 3);
    const second = Buffer.from(first);
    second[(3 * width + 3) * 3] = 64;
    const png = (raw) =>
      sharp(raw, { raw: { width, height, channels: 3 } })
        .png()
        .toBuffer();

    const result = await compareCanvasScreenshots(await png(first), await png(second), {
      viewport: { width, height },
      rect: { x: 2, y: 2, width: 4, height: 4 },
    });

    expect(result).toMatchObject({
      crop: { left: 2, top: 2, width: 4, height: 4 },
      changedPixels: 1,
      totalPixels: 16,
      changedPct: 6.25,
    });
  });
});
