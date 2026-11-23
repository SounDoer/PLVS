#!/usr/bin/env node
/**
 * Runs the Rust file-analysis tests with real FFmpeg sidecars present.
 *
 * `cargo test` normally skips the end-to-end file-analysis tests when the
 * sidecar binaries are absent. The release and Preview workflows should prove the real decode
 * path once, so this script stages platform sidecars under their runtime names and
 * points PLVS_FFMPEG_DIR at that directory.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasFileAnalysisSidecars, withFileAnalysisSidecars } from "./file-analysis-sidecars.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!hasFileAnalysisSidecars()) {
  console.log(`Skipping file-analysis smoke: no sidecar assets for ${process.platform}.`);
  process.exit(0);
}

try {
  process.exitCode = await withFileAnalysisSidecars("plvs-file-analysis-smoke-", (staged) => {
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
      }
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
