#!/usr/bin/env node
// Sharesets preview fixtures: the real meter pipeline run offline over the arranged "Full Band
// Crescendo" stems (stereo and 5.1) and the dialogue benchmark corpus. Check mode (default) fails
// when a committed fixture differs from the producer; `--write` replaces it. Both music beds are
// mixed here from the stems in the audio archive; without it they are reported as source
// unavailable and only the dialogue fixtures are checked or written.
// Dialogue inputs use the hash-pinned 48 kHz speech PCM; generation does not resample on this host.
// See docs/history/specs/2026-10-30-sharesets-preview-fixtures-design.md.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDefaultSharesetsPreviewAnalysisRequests } from "../src/sharesets-preview/defaultAnalysisRequests.js";
import { generateDialogueBenchmarkFixtures } from "./dialogue-benchmark-fixtures.mjs";
import { floatWav } from "./marketing/homepage-audio.mjs";
import {
  BED_51_CHANNELS,
  BED_51_PLACEMENT,
  BED_PEAK_DBFS,
  HOMEPAGE_ARRANGEMENT,
  mixBed,
  parseFixtureArgs,
  readArchivedBeds,
} from "./marketing/music-beds.mjs";
import {
  repositoryRoot as root,
  runPreviewFixtureProducer,
  stageFfmpegSidecars,
  writeOrCheckFixture,
} from "./preview-fixture-producer.mjs";

const sourceDir = join(root, "assets", "marketing", "audio", "full-band-crescendo");
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
// Both music beds are the homepage arrangement; each fixture meters its last 60 s.
const WINDOW_END_MS = HOMEPAGE_ARRANGEMENT.durationMs;

const USAGE = "Usage: npm run sharesets:fixture -- [--write] [--archive <audio-archive>]";
const { write, archiveDir } = parseFixtureArgs(process.argv.slice(2), USAGE);

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

const source = JSON.parse(
  await readFile(join(sourceDir, "full-band-crescendo.source.json"), "utf8")
);
const beds = archiveDir ? await readArchivedBeds(archiveDir, source) : null;

const sidecars = await stageFfmpegSidecars("plvs-sharesets-preview-");
const staged = sidecars.dir;
try {
  const analysisRequests = buildDefaultSharesetsPreviewAnalysisRequests();
  const requestsPath = join(staged, "analysis-requests.json");
  await writeFile(requestsPath, JSON.stringify(analysisRequests), "utf8");
  const dialogueCorpusRoot = join(staged, "dialogue-corpus");
  await generateDialogueBenchmarkFixtures({
    outputRoot: dialogueCorpusRoot,
  });
  const dialogueSurroundPreviewPath = join(dialogueCorpusRoot, "surround-dialogue-preview.wav");
  await buildDialogueSurroundPreview(
    join(dialogueCorpusRoot, "surround-dialogue.wav"),
    dialogueSurroundPreviewPath
  );

  async function generateFixture(sourcePath, layout, outputPath, { windowEndMs, derivation } = {}) {
    const fixture = runPreviewFixtureProducer({
      audioPath: sourcePath,
      requestsPath,
      layout,
      windowEndMs,
      ffmpegDir: staged,
    });
    if (derivation) fixture.source.derivation = derivation;
    await writeOrCheckFixture(fixture, outputPath, {
      write,
      command: "npm run sharesets:fixture",
    });
  }

  if (!beds) {
    for (const path of [fixturePath, multichannelFixturePath]) {
      console.log(
        `${path}: source unavailable (pass --archive or set PLVS_AUDIO_ARCHIVE); skipped.`
      );
    }
  } else {
    const { stems, sampleRateHz, stereoWav } = beds;
    const stereoPath = join(staged, source.arranged.fileName);
    await writeFile(stereoPath, stereoWav);
    await generateFixture(stereoPath, "stereo", fixturePath, {
      windowEndMs: WINDOW_END_MS,
      derivation: {
        sourceFileName: source.arranged.fileName,
        sourceSha256: source.arranged.sha256,
        songSha256: source.song.originalSha256,
        recipe: "plvs-homepage-arranged-stems",
        recipeVersion: 1,
        songStartMs: HOMEPAGE_ARRANGEMENT.songStartMs,
      },
    });
    const bed = mixBed(stems, {
      placement: BED_51_PLACEMENT,
      channels: BED_51_CHANNELS,
      sampleRateHz,
    });
    const surroundPath = join(staged, "full-band-crescendo-5-1.wav");
    await writeFile(surroundPath, floatWav(bed.samples, BED_51_CHANNELS.length, sampleRateHz));
    await generateFixture(surroundPath, "5.1", multichannelFixturePath, {
      windowEndMs: WINDOW_END_MS,
      derivation: {
        sourceFileName: "Suno stems of full-band-crescendo",
        stemSha256: Object.fromEntries(
          source.stems.files
            .filter(({ used }) => used)
            .map(({ fileName, sha256 }) => [fileName, sha256])
        ),
        recipe: "plvs-sharesets-arranged-stems-5-1",
        recipeVersion: 1,
        songStartMs: HOMEPAGE_ARRANGEMENT.songStartMs,
        peakDbfs: BED_PEAK_DBFS,
      },
    });
  }
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
