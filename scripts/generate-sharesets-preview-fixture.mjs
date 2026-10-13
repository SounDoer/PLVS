#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { buildDefaultSharesetsPreviewAnalysisRequests } from "../src/sharesets-preview/defaultAnalysisRequests.js";
import {
  buildPolarLevelMaxHoldTable,
  polarLevelMaxHoldAt,
} from "../src/math/vectorscopePolarMath.js";
import { buildDerivedSurround51Wav } from "./sharesets-preview-audio.mjs";
import { generateDialogueBenchmarkFixtures } from "./dialogue-benchmark-fixtures.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const audioPath = join(root, "assets", "marketing", "audio", "discovery-hero.wav");
const fixturePath = join(root, "src", "transfer", "fixtures", "sharesetsPreviewV5.json");
const multichannelFixturePath = join(
  root,
  "src",
  "transfer",
  "fixtures",
  "sharesetsPreviewMultichannelV1.json"
);
const dialogueStereoFixturePath = join(
  root,
  "src",
  "transfer",
  "fixtures",
  "sharesetsPreviewDialogueStereoV1.json"
);
const dialogueMultichannelFixturePath = join(
  root,
  "src",
  "transfer",
  "fixtures",
  "sharesetsPreviewDialogueMultichannelV1.json"
);
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

async function buildDialogueSurroundPreview(sourcePath, outputPath) {
  const wav = Buffer.from(await readFile(sourcePath));
  const channels = wav.readUInt16LE(22);
  const format = wav.readUInt16LE(20);
  const bitsPerSample = wav.readUInt16LE(34);
  if (
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    channels !== 6 ||
    format !== 3 ||
    bitsPerSample !== 32
  ) {
    throw new Error("Dialogue 5.1 preview source must be a six-channel float32 WAV.");
  }
  const frameBytes = channels * 4;
  const lfeOffset = 3 * 4;
  const lfeScale = 10 ** (-18 / 20);
  for (let frameOffset = 44; frameOffset + frameBytes <= wav.length; frameOffset += frameBytes) {
    const offset = frameOffset + lfeOffset;
    wav.writeFloatLE(wav.readFloatLE(offset) * lfeScale, offset);
  }
  await writeFile(outputPath, wav);
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
  console.error(`Sharesets preview Fixture generation is unsupported on ${process.platform}.`);
  process.exit(1);
}
for (const name of Object.values(assets.source)) {
  if (!existsSync(join(binDir, name))) {
    console.error(`Missing FFmpeg sidecar: ${name}. Run \`npm run ffmpeg:fetch\` first.`);
    process.exit(1);
  }
}

const staged = await mkdtemp(join(tmpdir(), "plvs-sharesets-preview-"));
try {
  for (const key of ["ffmpeg", "ffprobe"]) {
    const destination = join(staged, assets.runtime[key]);
    await cp(join(binDir, assets.source[key]), destination, { force: true });
    if (process.platform !== "win32") await chmod(destination, 0o755);
  }
  const analysisRequests = buildDefaultSharesetsPreviewAnalysisRequests();
  const requestsPath = join(staged, "analysis-requests.json");
  await writeFile(requestsPath, JSON.stringify(analysisRequests), "utf8");
  const surroundPath = join(staged, "discovery-hero-5-1-derived.wav");
  await buildDerivedSurround51Wav({
    ffmpegPath: join(staged, assets.runtime.ffmpeg),
    sourcePath: audioPath,
    outputPath: surroundPath,
  });
  const dialogueCorpusRoot = join(staged, "dialogue-corpus");
  await generateDialogueBenchmarkFixtures({
    outputRoot: dialogueCorpusRoot,
    ffmpeg: join(staged, assets.runtime.ffmpeg),
  });
  const dialogueSurroundPreviewPath = join(dialogueCorpusRoot, "surround-dialogue-preview.wav");
  await buildDialogueSurroundPreview(
    join(dialogueCorpusRoot, "surround-dialogue.wav"),
    dialogueSurroundPreviewPath
  );

  async function generateFixture(sourcePath, layout, outputPath) {
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
        sourcePath,
        requestsPath,
        layout,
      ],
      {
        cwd: root,
        env: { ...process.env, PLVS_FFMPEG_DIR: staged },
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || "Sharesets preview Fixture generation failed.");
    }
    const prettierConfig = (await resolveConfig(outputPath)) ?? {};
    const fixture = finalizeVectorscopeState(JSON.parse(result.stdout));
    const generated = await format(JSON.stringify(fixture), { ...prettierConfig, parser: "json" });
    if (write) {
      await writeFile(outputPath, generated, "utf8");
      console.log(`Wrote ${outputPath}`);
      return;
    }
    const current = await readFile(outputPath, "utf8").catch(() => null);
    if (current !== generated) {
      throw new Error(`${outputPath} is stale. Run \`npm run sharesets:fixture -- --write\`.`);
    }
    console.log(`${outputPath} matches the production analyzer.`);
  }

  await generateFixture(audioPath, "stereo", fixturePath);
  await generateFixture(surroundPath, "5.1", multichannelFixturePath);
  await generateFixture(
    join(dialogueCorpusRoot, "stereo-antiphase.wav"),
    "dialogue-stereo",
    dialogueStereoFixturePath
  );
  await generateFixture(
    dialogueSurroundPreviewPath,
    "dialogue-5.1",
    dialogueMultichannelFixturePath
  );
} finally {
  await rm(staged, { recursive: true, force: true });
}
