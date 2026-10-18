#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [outputArgument, ffmpegArgument = "ffmpeg"] = process.argv.slice(2);
if (!outputArgument) {
  throw new Error("Usage: generate-sidecar-fixtures.mjs <output-directory> [full-ffmpeg]");
}

const output = resolve(outputArgument);
mkdirSync(output, { recursive: true });
const sampleRate = 48_000;
const channels = 2;
const frames = sampleRate;
const bytesPerSample = 2;
const pcm = Buffer.alloc(frames * channels * bytesPerSample);
for (let frame = 0; frame < frames; frame += 1) {
  const left = Math.round(3_000 * Math.sin((frame * 2 * Math.PI * 997) / sampleRate));
  const right = Math.round(1_500 * Math.sin((frame * 2 * Math.PI * 499) / sampleRate));
  pcm.writeInt16LE(left, (frame * channels + 0) * bytesPerSample);
  pcm.writeInt16LE(right, (frame * channels + 1) * bytesPerSample);
}
const wav = Buffer.alloc(44 + pcm.length);
wav.write("RIFF", 0, "ascii");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8, "ascii");
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(channels, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
wav.writeUInt16LE(channels * bytesPerSample, 32);
wav.writeUInt16LE(bytesPerSample * 8, 34);
wav.write("data", 36, "ascii");
wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);
const source = join(output, "signal.wav");
writeFileSync(source, wav);

const fixtures = [
  ["flac", "flac", []],
  ["aac", "m4a", []],
  ["ac3", "mka", []],
  ["eac3", "mka", []],
  ["dca", "mka", ["-strict", "-2"]],
  ["libopus", "ogg", []],
  ["vorbis", "ogg", ["-strict", "-2"]],
  ["libmp3lame", "mp3", []],
  ["alac", "m4a", []],
  ["pcm_s24le", "wav", []],
];
for (const [codec, extension, extra] of fixtures) {
  const result = spawnSync(
    ffmpegArgument,
    [
      "-nostdin",
      "-y",
      "-v",
      "error",
      "-i",
      source,
      "-c:a",
      codec,
      ...extra,
      join(output, `${codec}.${extension}`),
    ],
    { encoding: "utf8", timeout: 30_000 }
  );
  if (result.status !== 0) {
    throw new Error(`${codec} fixture generation failed: ${result.stderr || result.error}`);
  }
}
writeFileSync(
  join(output, "manifest.json"),
  `${JSON.stringify({ schemaVersion: 1, channels, sampleRate, fixtures: fixtures.map(([codec, extension]) => `${codec}.${extension}`) }, null, 2)}\n`
);
console.log(`Generated ${fixtures.length} sidecar fixtures in ${output}`);
