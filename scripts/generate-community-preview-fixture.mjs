#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { buildDefaultCommunityPreviewAnalysisRequests } from "../src/community-preview/defaultAnalysisRequests.js";
import {
  buildPolarLevelMaxHoldTable,
  polarLevelMaxHoldAt,
} from "../src/math/vectorscopePolarMath.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const audioPath = join(root, "assets", "marketing", "audio", "discovery-hero.wav");
const fixturePath = join(root, "src", "transfer", "fixtures", "communityPreviewV5.json");
const binDir = join(root, "src-tauri", "binaries");
const write = process.argv.slice(2).includes("--write");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--write");

function indexedView(rows) {
  return {
    length: rows.length,
    rowAt: (index) => ({ pairs: rows[index]?.pairs ?? [] }),
    timestampAt: (index) => rows[index]?.atMs ?? Number.NaN,
  };
}

function finalizeVectorscopeState(fixture) {
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

if (unknown.length > 0) {
  console.error(`Unknown option: ${unknown[0]}`);
  process.exit(2);
}

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

const assets = assetsByPlatform[process.platform];
if (!assets) {
  console.error(`Community preview Fixture generation is unsupported on ${process.platform}.`);
  process.exit(1);
}
for (const name of Object.values(assets.source)) {
  if (!existsSync(join(binDir, name))) {
    console.error(`Missing FFmpeg sidecar: ${name}. Run \`npm run ffmpeg:fetch\` first.`);
    process.exit(1);
  }
}

const staged = await mkdtemp(join(tmpdir(), "plvs-community-preview-"));
try {
  for (const key of ["ffmpeg", "ffprobe"]) {
    const destination = join(staged, assets.runtime[key]);
    await cp(join(binDir, assets.source[key]), destination, { force: true });
    if (process.platform !== "win32") await chmod(destination, 0o755);
  }
  const analysisRequests = buildDefaultCommunityPreviewAnalysisRequests();
  const requestsPath = join(staged, "analysis-requests.json");
  await writeFile(requestsPath, JSON.stringify(analysisRequests), "utf8");
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--quiet",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--example",
      "community_preview_fixture",
      "--",
      audioPath,
      requestsPath,
    ],
    {
      cwd: root,
      env: { ...process.env, PLVS_FFMPEG_DIR: staged },
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }
  );
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "Community preview Fixture generation failed.\n");
    process.exitCode = result.status ?? 1;
  } else {
    const prettierConfig = (await resolveConfig(fixturePath)) ?? {};
    const fixture = finalizeVectorscopeState(JSON.parse(result.stdout));
    const generated = await format(JSON.stringify(fixture), { ...prettierConfig, parser: "json" });
    if (write) {
      await writeFile(fixturePath, generated, "utf8");
      console.log(`Wrote ${fixturePath}`);
    } else {
      const current = await readFile(fixturePath, "utf8").catch(() => null);
      if (current !== generated) {
        console.error(
          "Community preview Fixture is stale. Run `npm run community:fixture -- --write`."
        );
        process.exitCode = 1;
      } else {
        console.log("Community preview Fixture matches the production analyzer.");
      }
    }
  }
} finally {
  await rm(staged, { recursive: true, force: true });
}
