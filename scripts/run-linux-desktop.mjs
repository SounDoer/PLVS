#!/usr/bin/env node
// Development only: use explicitly located system decoders, not unverified release sidecars.
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlvsCli } from "./build-plvs-cli.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  if (process.platform !== "linux") throw new Error("Run desktop:linux inside Linux or WSL2.");
  const decoderDirectory = process.env.PLVS_FFMPEG_DIR || "/usr/bin";
  if (!isAbsolute(decoderDirectory)) throw new Error("PLVS_FFMPEG_DIR must be an absolute path.");
  for (const name of ["ffmpeg", "ffprobe"]) {
    const result = spawnSync(join(decoderDirectory, name), ["-version"], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Install ${name}, or set PLVS_FFMPEG_DIR to its directory.`);
    }
  }
  buildPlvsCli({ profile: "debug", identity: "development", stage: true });
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
      "dev",
      "--config",
      "src-tauri/tauri.dev.conf.json",
      "--config",
      "src-tauri/tauri.linux-dev.conf.json",
      "--features",
      "dev-identity",
      ...process.argv.slice(2),
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, PLVS_FFMPEG_DIR: decoderDirectory },
    }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
