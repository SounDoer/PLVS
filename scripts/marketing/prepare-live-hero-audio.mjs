// Prepare a repeatable, credited excerpt without flattening its musical dynamics.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const output = resolve(process.argv[2] ?? "artifacts/marketing/live-hero-thresholds");
const sourceUrl =
  "https://www.scottbuckley.com.au/library/wp-content/uploads/2020/01/sb_discovery.mp3";
const sourcePage = "https://www.scottbuckley.com.au/library/discovery/";
const sourceSha256 = "e4629422bd18a927950167dabfbe7c77c061595329da367f2407a8b4021fb832";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(output, { recursive: true });
const sourcePath = join(output, "discovery-original.mp3");
let source;
try {
  source = await readFile(sourcePath);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Audio download failed: HTTP ${response.status}`);
  source = Buffer.from(await response.arrayBuffer());
  if (hash(source) !== sourceSha256)
    throw new Error("Source audio changed; review before updating the recipe.");
  await writeFile(sourcePath, source);
}
if (hash(source) !== sourceSha256)
  throw new Error("Source audio does not match the pinned recording.");
const pcmPath = join(output, "discovery.f32");
const ffmpeg = resolve("src-tauri/binaries/ffmpeg-x86_64-pc-windows-msvc.exe");
execFileSync(
  ffmpeg,
  ["-v", "error", "-y", "-i", sourcePath, "-ac", "2", "-ar", "48000", "-f", "f32le", pcmPath],
  { windowsHide: true }
);
const pcm = await readFile(pcmPath);
const rate = 48000,
  start = 80,
  duration = 90,
  gain = 1.07;
const frames = rate * duration;
if (pcm.length < (start + duration) * rate * 8) throw new Error("Decoded audio is too short.");
const wav = Buffer.alloc(44 + frames * 6);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 6, 28);
wav.writeUInt16LE(6, 32);
wav.writeUInt16LE(24, 34);
wav.write("data", 36);
wav.writeUInt32LE(frames * 6, 40);
let peak = 0;
for (let i = 0; i < frames * 2; i++) {
  const value = pcm.readFloatLE(start * rate * 8 + i * 4) * gain;
  if (!Number.isFinite(value) || Math.abs(value) >= 1)
    throw new Error("Invalid or clipped source sample.");
  peak = Math.max(peak, Math.abs(value));
  wav.writeIntLE(Math.round(value * 8388607), 44 + i * 3, 3);
}
const fileName = "Discovery - 80-170s.wav";
await writeFile(join(output, fileName), wav);
const attribution =
  "'Discovery' by Scott Buckley — released under CC BY 4.0. www.scottbuckley.com.au";
const recipe = {
  version: 1,
  source: {
    title: "Discovery",
    artist: "Scott Buckley",
    page: sourcePage,
    download: sourceUrl,
    sha256: sourceSha256,
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution,
  },
  excerpt: {
    startSeconds: start,
    endSeconds: start + duration,
    durationSeconds: duration,
    linearGain: gain,
    modifications:
      "Excerpt and constant gain only; no compression, EQ, time stretching, or synthetic additions.",
    fileName,
    sampleRateHz: rate,
    channels: 2,
    bits: 24,
    peakDbfs: 20 * Math.log10(peak),
    sha256: hash(wav),
  },
  capture: {
    mode: "LIVE",
    layout: "Unmodified first-run default",
    panelSettings: "Unmodified defaults",
    device: "CABLE Output (VB-Audio Virtual Cable)",
    playback: "VLC to CABLE Input; no system output changes",
    candidatesSecondsAfterPlayerLaunch: [62, 66, 70, 74, 78, 82],
    determinism:
      "Audio bytes and layout are fixed. LIVE scheduling and render frames can vary; inspect candidates before publishing.",
  },
};
await writeFile(join(output, "audio-recipe.json"), JSON.stringify(recipe, null, 2) + "\n");
await writeFile(
  join(output, "ATTRIBUTION.txt"),
  `${attribution}\nSource: ${sourcePage}\nLicense: ${recipe.source.licenseUrl}\nChanges: ${recipe.excerpt.modifications}\n`
);
console.log(JSON.stringify(recipe.excerpt, null, 2));
