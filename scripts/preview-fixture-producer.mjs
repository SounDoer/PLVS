import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { comparePreviewFixtures, describeFixtureComparison } from "./preview-fixture-compare.mjs";
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
 * Write explicitly requested JSON, or compare against the committed fixture with narrow visual
 * floating-point allowances. Check mode never rewrites the baseline or its provenance hash.
 */
export async function writeOrCheckFixture(fixture, outputPath, { write, command }) {
  if (write) {
    const validation = comparePreviewFixtures(fixture, fixture);
    if (!validation.matches)
      throw new Error(`Invalid generated fixture:\n${describeFixtureComparison(validation)}`);
    const prettierConfig = (await resolveConfig(outputPath)) ?? {};
    const generated = await format(JSON.stringify(fixture), { ...prettierConfig, parser: "json" });
    await writeFile(outputPath, generated, "utf8");
    console.log(`Wrote ${outputPath}`);
    return;
  }
  const current = await readFile(outputPath, "utf8").catch((error) => {
    if (error.code === "ENOENT")
      throw new Error(
        `${outputPath} is missing. Review inputs before running \`${command} -- --write\`.`
      );
    throw error;
  });
  let expected;
  try {
    expected = JSON.parse(current);
  } catch {
    throw new Error(
      `${outputPath} is not valid JSON. Restore or review the baseline before regenerating it.`
    );
  }
  const comparison = comparePreviewFixtures(expected, fixture);
  if (!comparison.matches) {
    throw new Error(
      `${outputPath} differs from the production analyzer (${comparison.mismatchCount} mismatches).\n` +
        `${describeFixtureComparison(comparison)}\n` +
        `Investigate these differences before intentionally regenerating with \`${command} -- --write\`.`
    );
  }
  console.log(
    `${outputPath} matches the production analyzer${comparison.toleratedCount ? ` with ${comparison.toleratedCount} bounded visual floating-point differences` : " exactly"}.`
  );
  if (comparison.toleratedCount) console.log(describeFixtureComparison(comparison));
}
