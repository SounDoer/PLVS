import { mkdtemp, cp, chmod, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  linux: {
    source: {
      ffmpeg: "ffmpeg-x86_64-unknown-linux-gnu",
      ffprobe: "ffprobe-x86_64-unknown-linux-gnu",
    },
    runtime: { ffmpeg: "ffmpeg", ffprobe: "ffprobe" },
  },
};

export async function withFileAnalysisSidecars(prefix, run) {
  const assets = PLATFORM_ASSETS[process.platform];
  if (!assets) throw new Error(`No FFmpeg sidecar assets for ${process.platform}.`);

  for (const name of Object.values(assets.source)) {
    if (!existsSync(join(binDir, name))) {
      throw new Error(`Missing sidecar asset: ${name}. Run npm run ffmpeg:fetch first.`);
    }
  }

  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    for (const key of ["ffmpeg", "ffprobe"]) {
      const dest = join(dir, assets.runtime[key]);
      await cp(join(binDir, assets.source[key]), dest);
      if (process.platform !== "win32") await chmod(dest, 0o755);
    }
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function hasFileAnalysisSidecars(platform = process.platform) {
  return Object.hasOwn(PLATFORM_ASSETS, platform);
}
