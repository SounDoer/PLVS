#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDefaultSharesetsPreviewAnalysisRequests } from "../src/sharesets-preview/defaultAnalysisRequests.js";
import { buildDerivedSurround51Wav } from "./sharesets-preview-audio.mjs";
import { generateDialogueBenchmarkFixtures } from "./dialogue-benchmark-fixtures.mjs";
import {
  repositoryRoot as root,
  runPreviewFixtureProducer,
  stageFfmpegSidecars,
  writeOrCheckFixture,
} from "./preview-fixture-producer.mjs";

const audioPath = join(root, "assets", "marketing", "audio", "discovery-hero.wav");
const fixturePath = join(root, "src", "transfer", "fixtures", "sharesetsPreviewStereoV1.json");
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
const write = process.argv.slice(2).includes("--write");
const unknown = process.argv.slice(2).filter((argument) => argument !== "--write");

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

const sidecars = await stageFfmpegSidecars("plvs-sharesets-preview-");
const staged = sidecars.dir;
try {
  const analysisRequests = buildDefaultSharesetsPreviewAnalysisRequests();
  const requestsPath = join(staged, "analysis-requests.json");
  await writeFile(requestsPath, JSON.stringify(analysisRequests), "utf8");
  const surroundPath = join(staged, "discovery-hero-5-1-derived.wav");
  await buildDerivedSurround51Wav({
    ffmpegPath: sidecars.ffmpeg,
    sourcePath: audioPath,
    outputPath: surroundPath,
  });
  const dialogueCorpusRoot = join(staged, "dialogue-corpus");
  await generateDialogueBenchmarkFixtures({
    outputRoot: dialogueCorpusRoot,
    ffmpeg: sidecars.ffmpeg,
  });
  const dialogueSurroundPreviewPath = join(dialogueCorpusRoot, "surround-dialogue-preview.wav");
  await buildDialogueSurroundPreview(
    join(dialogueCorpusRoot, "surround-dialogue.wav"),
    dialogueSurroundPreviewPath
  );

  async function generateFixture(sourcePath, layout, outputPath) {
    const fixture = runPreviewFixtureProducer({
      audioPath: sourcePath,
      requestsPath,
      layout,
      ffmpegDir: staged,
    });
    await writeOrCheckFixture(fixture, outputPath, {
      write,
      command: "npm run sharesets:fixture",
    });
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
  await sidecars.cleanup();
}
