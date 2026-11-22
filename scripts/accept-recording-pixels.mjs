import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { locateVlc } from "./capture-rig.mjs";

/** The rig's VLC decodes the MP4. Sample frames from the original stream, independent of PLVS's counters. */
export async function assertRecordingPixels(path, { fps, afterSeconds = 0 }) {
  const directory = await mkdtemp(join(tmpdir(), "plvs-recording-frames-"));
  const ratio = 3;
  try {
    const decoded = spawnSync(
      locateVlc(),
      [
        "-I",
        "dummy",
        "--ignore-config",
        "--no-audio",
        "--no-video-title-show",
        "--vout",
        "dummy",
        "--avcodec-hw=none",
        "--video-filter",
        "scene",
        "--scene-format=png",
        "--scene-prefix=plvs-frame-",
        "--scene-width=128",
        "--scene-height=72",
        `--scene-ratio=${ratio}`,
        `--scene-path=${directory}`,
        "--no-loop",
        "--no-repeat",
        path,
        "vlc://quit",
      ],
      { timeout: 35_000, encoding: "utf8", windowsHide: true }
    );
    if (decoded.error) throw decoded.error;
    assert.equal(decoded.status, 0, "VLC could not decode the test recording.");
    let before = false;
    let after = false;
    for (const name of (await readdir(directory)).sort()) {
      const match = /^plvs-frame-(\d+)\.png$/.exec(name);
      if (!match) continue;
      const seconds = (Number(match[1]) - 1) / fps;
      const { channels } = await sharp(join(directory, name)).removeAlpha().stats();
      // A frozen or moving PLVS image contains both background and much brighter controls.
      // A uniform black (or gray) decoder output has no such contrast.
      const hasPicture = channels.some(({ min, max }) => max - min >= 24);
      if (seconds >= 0.2 && (afterSeconds === 0 || seconds < afterSeconds - 0.2))
        before ||= hasPicture;
      if (seconds >= afterSeconds + 0.1) after ||= hasPicture;
    }
    assert.ok(before, "The recording contained no visible picture near its start.");
    if (afterSeconds > 0)
      assert.ok(after, "The recording contained no visible picture after restore.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
