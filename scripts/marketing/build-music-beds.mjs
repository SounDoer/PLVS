#!/usr/bin/env node
// Build the arranged stereo bed of "Full Band Crescendo" from its Suno stems. Check mode (default)
// compares with the committed WAV byte for byte; --write replaces it. After --write, update
// `arranged.sha256` in the source JSON and regenerate the fixtures (npm run homepage:fixture).
//   node scripts/marketing/build-music-beds.mjs --stems <stem-directory> [--write]
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256Hex } from "./homepage-audio.mjs";
import {
  BED_STEREO_CHANNELS,
  BED_STEREO_PLACEMENT,
  STEREO_MASTER,
  limitPeaks,
  mixBed,
  pcm24Wav,
  readArrangedStems,
} from "./music-beds.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SOURCE_DIR = join(ROOT, "assets", "marketing", "audio", "full-band-crescendo");

const args = process.argv.slice(2);
const write = args.includes("--write");
const stemsIndex = args.indexOf("--stems");
const stemsDir = stemsIndex >= 0 ? args[stemsIndex + 1] : process.env.PLVS_HOMEPAGE_STEMS;
const unknown = args.filter(
  (argument, index) => argument !== "--write" && index !== stemsIndex && index !== stemsIndex + 1
);
if (unknown.length > 0 || !stemsDir) {
  console.error(
    "Usage: node scripts/marketing/build-music-beds.mjs --stems <stem-directory> [--write]"
  );
  process.exit(2);
}

const source = JSON.parse(
  await readFile(join(SOURCE_DIR, "full-band-crescendo.source.json"), "utf8")
);
const { stems, sampleRateHz } = await readArrangedStems(stemsDir, source);
const { samples, gain } = mixBed(stems, {
  placement: BED_STEREO_PLACEMENT,
  channels: BED_STEREO_CHANNELS,
  sampleRateHz,
});
limitPeaks(samples, BED_STEREO_CHANNELS.length, sampleRateHz, STEREO_MASTER);
const wav = pcm24Wav(samples, BED_STEREO_CHANNELS.length, sampleRateHz);
const path = join(SOURCE_DIR, source.arranged.fileName);
if (write) {
  await writeFile(path, wav);
  console.log(
    `Wrote ${path} (mix gain ${(20 * Math.log10(gain)).toFixed(2)} dB, sha256 ${sha256Hex(wav)}).`
  );
} else {
  const current = await readFile(path).catch(() => null);
  if (!current?.equals(wav)) {
    throw new Error(`${path} is stale. Run with --write, then update the source JSON hash.`);
  }
  console.log(`${path} matches the stems.`);
}
