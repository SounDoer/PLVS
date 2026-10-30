import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import {
  buildPolarLevelMaxHoldTable,
  polarLevelMaxHoldAt,
} from "../src/math/vectorscopePolarMath.js";

export const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(repositoryRoot, "src-tauri", "binaries");

const assetsByPlatform = {
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

/**
 * Copy the bundled FFmpeg sidecars into a temporary directory under their runtime names, as the
 * producer resolves them through `PLVS_FFMPEG_DIR`. Exits the process when the platform or a
 * sidecar is unavailable.
 */
export async function stageFfmpegSidecars(prefix) {
  const assets = assetsByPlatform[process.platform];
  if (!assets) {
    console.error(`Preview Fixture generation is unsupported on ${process.platform}.`);
    process.exit(1);
  }
  for (const name of Object.values(assets.source)) {
    if (!existsSync(join(binDir, name))) {
      console.error(`Missing FFmpeg sidecar: ${name}. Run \`npm run ffmpeg:fetch\` first.`);
      process.exit(1);
    }
  }
  const dir = await mkdtemp(join(tmpdir(), prefix));
  for (const key of ["ffmpeg", "ffprobe"]) {
    const destination = join(dir, assets.runtime[key]);
    await cp(join(binDir, assets.source[key]), destination, { force: true });
    if (process.platform !== "win32") await chmod(destination, 0o755);
  }
  return {
    dir,
    ffmpeg: join(dir, assets.runtime.ffmpeg),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

function indexedView(rows) {
  return {
    length: rows.length,
    rowAt: (index) => ({ pairs: rows[index]?.pairs ?? [] }),
    timestampAt: (index) => rows[index]?.atMs ?? Number.NaN,
  };
}

export function finalizeVectorscopeState(fixture) {
  const durationMs = fixture.clock.durationMs;
  for (const result of Object.values(fixture.visuals.vectorscopeResultsByKey)) {
    const history = indexedView(result.history);
    const lastIndex = history.length - 1;
    result.maxHold = Array.from(
      polarLevelMaxHoldAt(buildPolarLevelMaxHoldTable(history), lastIndex) ?? []
    );
    // Polar Sample/Level only need the recent window to draw the final fan. Max Hold above is the
    // cumulative state since Clear, computed before trimming so the fixture stays compact without
    // changing the production meaning of the outline.
    result.history = result.history.filter(({ atMs }) => atMs + 500 >= durationMs);
  }
  return fixture;
}

/** Run the Rust producer (`sharesets_preview_fixture` example) and return the parsed fixture. */
export function runPreviewFixtureProducer({
  audioPath,
  requestsPath,
  layout,
  windowEndMs,
  ffmpegDir,
}) {
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--example",
      "sharesets_preview_fixture",
      "--",
      audioPath,
      requestsPath,
      layout,
      ...(windowEndMs === undefined ? [] : [String(windowEndMs)]),
    ],
    {
      cwd: repositoryRoot,
      env: { ...process.env, PLVS_FFMPEG_DIR: ffmpegDir },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || "Preview Fixture generation failed.");
  }
  return finalizeVectorscopeState(JSON.parse(result.stdout));
}

/**
 * Format a fixture as the committed JSON and either write it or check that the committed file
 * matches. `command` names the script to rerun with `--write`.
 */
export async function writeOrCheckFixture(fixture, outputPath, { write, command }) {
  const prettierConfig = (await resolveConfig(outputPath)) ?? {};
  const generated = await format(JSON.stringify(fixture), { ...prettierConfig, parser: "json" });
  if (write) {
    await writeFile(outputPath, generated, "utf8");
    console.log(`Wrote ${outputPath}`);
    return;
  }
  const current = await readFile(outputPath, "utf8").catch(() => null);
  if (current !== generated) {
    throw new Error(`${outputPath} is stale. Run \`${command} -- --write\`.`);
  }
  console.log(`${outputPath} matches the production analyzer.`);
}
