import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { comparePngDirectories } from "./ui-visual-compare-lib.mjs";

async function pixel(path, rgba) {
  await sharp(Buffer.from(rgba), { raw: { width: 1, height: 1, channels: 4 } })
    .png()
    .toFile(path);
}

describe("UI visual comparison", () => {
  it("reports exact pixel changes and writes a visible diff", async () => {
    const root = await mkdtemp(join(tmpdir(), "plvs-ui-compare-"));
    const beforeDir = join(root, "before");
    const afterDir = join(root, "after");
    const diffDir = join(root, "diff");
    await Promise.all([mkdir(beforeDir), mkdir(afterDir), mkdir(diffDir)]);
    await pixel(join(beforeDir, "same.png"), [1, 2, 3, 255]);
    await pixel(join(afterDir, "same.png"), [1, 2, 3, 255]);
    await pixel(join(beforeDir, "changed.png"), [10, 20, 30, 255]);
    await pixel(join(afterDir, "changed.png"), [10, 21, 30, 255]);

    const report = await comparePngDirectories({ beforeDir, afterDir, diffDir });

    expect(report.passed).toBe(false);
    expect(report.summary).toMatchObject({ compared: 2, identical: 1, changed: 1 });
    expect(report.results.find(({ path }) => path === "changed.png")).toMatchObject({
      status: "changed",
      changedPixels: 1,
      totalPixels: 1,
      maxChannelDelta: 1,
    });
  });
});
