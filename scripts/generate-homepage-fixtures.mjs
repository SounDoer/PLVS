#!/usr/bin/env node
// Homepage image fixtures: the real meter pipeline run offline over an arrangement of the
// "Full Band Crescendo" stems. Check mode (default) fails when a committed fixture differs from
// the producer; `--write` replaces it. Both beds are mixed here from the stems in the audio
// archive; without it both fixtures are reported as source unavailable.
// See docs/history/specs/2026-10-29-homepage-images-renderer-design.md.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDefaultSharesetsPreviewAnalysisRequests } from "../src/sharesets-preview/defaultAnalysisRequests.js";
import { floatWav } from "./marketing/homepage-audio.mjs";
import {
  BED_714_CHANNELS,
  BED_714_PLACEMENT,
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
const fixturesDir = join(root, "src", "transfer", "fixtures");

// Both beds are the same 75 s arrangement; each fixture meters its last 60 s, after 15 s of
// pre-roll. At the end of the stereo bed the starter Profile reads Integrated warn, Short-term
// warn and True Peak fail, with Momentary below its warning.
const WINDOW_END_MS = HOMEPAGE_ARRANGEMENT.durationMs;
const HOMEPAGE_STEREO = Object.freeze({
  layout: "homepage-stereo",
  output: "homepageStereoV1.json",
});
const HOMEPAGE_714 = Object.freeze({
  layout: "homepage-7.1.4",
  output: "homepageMultichannel714V1.json",
});

const USAGE = "Usage: npm run homepage:fixture -- [--write] [--archive <audio-archive>]";
const { write, archiveDir } = parseFixtureArgs(process.argv.slice(2), USAGE);
if (!archiveDir) {
  for (const { output } of [HOMEPAGE_STEREO, HOMEPAGE_714]) {
    console.log(
      `${output}: source unavailable (pass --archive or set PLVS_AUDIO_ARCHIVE); skipped.`
    );
  }
  process.exit(0);
}

const source = JSON.parse(
  await readFile(join(sourceDir, "full-band-crescendo.source.json"), "utf8")
);
const { stems, sampleRateHz, stereoWav } = await readArchivedBeds(archiveDir, source);

const sidecars = await stageFfmpegSidecars("plvs-homepage-fixture-");
try {
  const requestsPath = join(sidecars.dir, "analysis-requests.json");
  await writeFile(
    requestsPath,
    JSON.stringify(buildDefaultSharesetsPreviewAnalysisRequests()),
    "utf8"
  );
  // The multichannel scene shows Level Meter, Stats and Waveform only.
  const multichannelRequestsPath = join(sidecars.dir, "analysis-requests-714.json");
  await writeFile(
    multichannelRequestsPath,
    JSON.stringify({ spectrum: [], vectorscope: [], stereoMap: [], spectralWaveform: true }),
    "utf8"
  );

  const stereoPath = join(sidecars.dir, source.arranged.fileName);
  await writeFile(stereoPath, stereoWav);
  const fixture = runPreviewFixtureProducer({
    audioPath: stereoPath,
    requestsPath,
    layout: HOMEPAGE_STEREO.layout,
    windowEndMs: WINDOW_END_MS,
    ffmpegDir: sidecars.dir,
  });
  fixture.source.derivation = {
    sourceFileName: source.arranged.fileName,
    sourceSha256: source.arranged.sha256,
    songSha256: source.song.originalSha256,
    recipe: "plvs-homepage-arranged-stems",
    recipeVersion: 1,
    songStartMs: HOMEPAGE_ARRANGEMENT.songStartMs,
  };
  await writeOrCheckFixture(fixture, join(fixturesDir, HOMEPAGE_STEREO.output), {
    write,
    command: "npm run homepage:fixture",
  });

  const bed = mixBed(stems, {
    placement: BED_714_PLACEMENT,
    channels: BED_714_CHANNELS,
    sampleRateHz,
  });
  const bedPath = join(sidecars.dir, "full-band-crescendo-7-1-4.wav");
  await writeFile(bedPath, floatWav(bed.samples, BED_714_CHANNELS.length, sampleRateHz));
  const multichannel = runPreviewFixtureProducer({
    audioPath: bedPath,
    requestsPath: multichannelRequestsPath,
    layout: HOMEPAGE_714.layout,
    windowEndMs: WINDOW_END_MS,
    ffmpegDir: sidecars.dir,
  });
  multichannel.source.derivation = {
    sourceFileName: "Suno stems of full-band-crescendo",
    stemSha256: Object.fromEntries(
      source.stems.files
        .filter(({ used }) => used)
        .map(({ fileName, sha256 }) => [fileName, sha256])
    ),
    recipe: "plvs-homepage-arranged-stems-7-1-4",
    recipeVersion: 1,
    songStartMs: HOMEPAGE_ARRANGEMENT.songStartMs,
    peakDbfs: BED_PEAK_DBFS,
  };
  await writeOrCheckFixture(multichannel, join(fixturesDir, HOMEPAGE_714.output), {
    write,
    command: "npm run homepage:fixture",
  });
} finally {
  await sidecars.cleanup();
}
