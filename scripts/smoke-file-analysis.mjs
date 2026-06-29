#!/usr/bin/env node
/**
 * Runs the Rust file-analysis tests with real FFmpeg sidecars present.
 *
 * `cargo test` normally skips the end-to-end file-analysis tests when the
 * sidecar binaries are absent. Release builds should prove the real decode path
 * once, so this script stages platform sidecars under their runtime names and
 * points PLVS_FFMPEG_DIR at that directory.
 */
import { mkdtemp, cp, chmod, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(root, "src-tauri", "binaries");

const PLATFORM_ASSETS = {
  win32: {
    source: {
      ffmpeg: "ffmpeg-x86_64-pc-windows-msvc.exe",
      ffprobe: "ffprobe-x86_64-pc-windows-msvc.exe",
    },
    runtime: { ffmpeg: "ffmpeg.exe", ffprobe: "ffprobe.exe" },
  },
  darwin: {
    source: {
      ffmpeg: "ffmpeg-aarch64-apple-darwin",
      ffprobe: "ffprobe-aarch64-apple-darwin",
    },
    runtime: { ffmpeg: "ffmpeg", ffprobe: "ffprobe" },
  },
};

const assets = PLATFORM_ASSETS[process.platform];
if (!assets) {
  console.log(`Skipping file-analysis smoke: no sidecar assets for ${process.platform}.`);
  process.exit(0);
}

for (const name of Object.values(assets.source)) {
  const path = join(binDir, name);
  if (!existsSync(path)) {
    console.error(`Missing sidecar asset: ${path}`);
    console.error("Run `npm run ffmpeg:fetch` first.");
    process.exit(1);
  }
}

const staged = await mkdtemp(join(tmpdir(), "plvs-file-analysis-smoke-"));

try {
  for (const key of ["ffmpeg", "ffprobe"]) {
    const src = join(binDir, assets.source[key]);
    const dest = join(staged, assets.runtime[key]);
    await cp(src, dest, { force: true });
    if (process.platform !== "win32") {
      await chmod(dest, 0o755);
    }
  }

  const result = spawnSync(
    "cargo",
    [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "file_analysis",
      "--",
      "--nocapture",
      "--test-threads=1",
    ],
    {
      cwd: root,
      env: { ...process.env, PLVS_FFMPEG_DIR: staged },
      stdio: "inherit",
    },
  );

  process.exitCode = result.status ?? 1;
} finally {
  await rm(staged, { recursive: true, force: true });
}
