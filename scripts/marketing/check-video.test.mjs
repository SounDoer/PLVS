import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkVideo, sampleTimes, validateConfig } from "./check-video.mjs";

it("validates configuration and refuses out-of-range review cues", () => {
  expect(() => validateConfig({ typo: 1 })).toThrow("Unknown");
  expect(() => validateConfig({ width: 1.5 })).toThrow("Invalid");
  expect(() => validateConfig({ fps: NaN })).toThrow("Invalid");
  expect(() => sampleTimes({ samples: [2] }, 2)).toThrow("outside");
  expect(() => sampleTimes({ transitions: [0] }, 2)).toThrow("outside");
  expect(
    sampleTimes({ samples: [1], transitions: [1], transitionOffsets: [-0.1, 0, 0.1] }, 2)
  ).toEqual([0.9, 1, 1.1]);
});

// Media tools are optional for ordinary app development. Real integration cases run when both
// are installed; no large fixture is committed. The pure configuration test always runs.
const available = ["ffmpeg", "ffprobe"].every(
  (exe) => spawnSync(exe, ["-version"], { windowsHide: true }).status === 0
);
describe.skipIf(!available)(
  "video review with real FFmpeg (requires ffmpeg and ffprobe on PATH)",
  () => {
    let root, video, silent;
    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), "plvs-video-"));
      video = join(root, "test clip.mp4");
      silent = join(root, "silent.mp4");
      execFileSync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          "testsrc2=size=160x90:rate=10:duration=1",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=1",
          "-c:v",
          "mpeg4",
          "-c:a",
          "aac",
          "-shortest",
          video,
        ],
        { windowsHide: true }
      );
      execFileSync("ffmpeg", ["-v", "error", "-i", video, "-an", "-c:v", "copy", silent], {
        windowsHide: true,
      });
    }, 30000);
    afterAll(async () => {
      if (root) await rm(root, { recursive: true, force: true });
    });

    it("decodes, compares audio and produces full-size frames and labeled sheets", async () => {
      const output = join(root, "valid");
      const report = await checkVideo({
        input: video,
        output,
        referenceAudio: video,
        config: { width: 160, height: 90, fps: 10, duration: 1, samples: [0.2, 0.8] },
      });
      expect(report.status).toBe("passed");
      expect(report.frames).toHaveLength(2);
      expect(report.contactSheets).toEqual(["contact-1.jpg"]);
      expect(report.manualReview.length).toBeGreaterThan(0);
      expect((await readFile(join(output, "frame-001.png"))).length).toBeGreaterThan(100);
      await expect(checkVideo({ input: video, output })).rejects.toThrow();
    }, 30000);

    it("fails missing audio unless silent footage was explicitly requested", async () => {
      expect(
        (
          await checkVideo({
            input: silent,
            output: join(root, "missing-audio"),
            config: { samples: [] },
          })
        ).status
      ).toBe("failed");
      expect(
        (
          await checkVideo({
            input: silent,
            output: join(root, "silent-ok"),
            config: { requireAudio: false, samples: [] },
          })
        ).status
      ).toBe("passed");
    }, 30000);

    it("reports corrupt input, incorrect dimensions and invalid timestamps", async () => {
      const corrupt = join(root, "broken.mp4");
      await writeFile(corrupt, "not a video");
      expect((await checkVideo({ input: corrupt, output: join(root, "corrupt") })).status).toBe(
        "failed"
      );
      expect(
        (
          await checkVideo({
            input: video,
            output: join(root, "wrong-size"),
            config: { width: 1920, samples: [] },
          })
        ).checks.find((c) => c.name === "width").status
      ).toBe("failed");
      expect(
        (
          await checkVideo({
            input: video,
            output: join(root, "bad-cue"),
            config: { samples: [50] },
          })
        ).error
      ).toContain("outside");
    }, 30000);

    it("detects a changed soundtrack", async () => {
      const other = join(root, "different.wav");
      execFileSync(
        "ffmpeg",
        ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=880:duration=1", other],
        { windowsHide: true }
      );
      const report = await checkVideo({
        input: video,
        output: join(root, "changed-audio"),
        referenceAudio: other,
        config: { samples: [] },
      });
      expect(report.checks.find((c) => c.name === "exact decoded audio").status).toBe("failed");
    }, 30000);
  }
);
