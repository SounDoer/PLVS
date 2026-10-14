#!/usr/bin/env node
// Compare a candidate pair against the previously shipped pair using real encoded fixtures.
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const [reference, candidate, fixtureEncoder] = process.argv.slice(2);
if (!reference || !candidate || !fixtureEncoder)
  throw new Error(
    "Usage: verify-ffmpeg-sidecars.mjs <reference-directory> <candidate-directory> <full-ffmpeg>"
  );
const suffix = process.platform === "win32" ? ".exe" : "";
const fixtures = await mkdtemp(join(tmpdir(), "plvs-codec-verification-"));
function run(program, args) {
  const result = spawnSync(program, args, { maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
  if (result.status !== 0) throw new Error(`${program} failed: ${result.error || result.stderr}`);
  return result.stdout;
}
try {
  for (const codec of [
    "ac3",
    "eac3",
    "dca",
    "libopus",
    "aac",
    "flac",
    "libvorbis",
    "libmp3lame",
    "pcm_s24le",
  ]) {
    const file = join(fixtures, `${codec}.mka`);
    run(fixtureEncoder, [
      "-nostdin",
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=997:sample_rate=48000:duration=1",
      "-c:a",
      codec,
      "-strict",
      "-2",
      file,
    ]);
    const args = [
      "-nostdin",
      "-loglevel",
      "error",
      "-i",
      file,
      "-map",
      "0:a:0",
      "-vn",
      "-f",
      "f32le",
      "pipe:1",
    ];
    const previous = run(join(resolve(reference), `ffmpeg${suffix}`), args);
    const next = run(join(resolve(candidate), `ffmpeg${suffix}`), args);
    if (!next.length || previous.length !== next.length || next.length % 4)
      throw new Error(`${codec}: changed PCM length`);
    let maxDifference = 0;
    for (let offset = 0; offset < next.length; offset += 4) {
      const difference = Math.abs(previous.readFloatLE(offset) - next.readFloatLE(offset));
      if (!Number.isFinite(difference)) throw new Error(`${codec}: non-finite PCM`);
      maxDifference = Math.max(maxDifference, difference);
    }
    if (maxDifference > 1e-6)
      throw new Error(`${codec}: changed decoded samples (${maxDifference})`);
    const probeArgs = ["-v", "error", "-show_streams", "-show_format", "-of", "json", file];
    const beforeProbe = run(join(resolve(reference), `ffprobe${suffix}`), probeArgs);
    const afterProbe = run(join(resolve(candidate), `ffprobe${suffix}`), probeArgs);
    if (!beforeProbe.equals(afterProbe)) throw new Error(`${codec}: changed probe metadata`);
    console.log(
      `${codec}: ${next.length / 4} samples; max absolute difference ${maxDifference}; probe unchanged`
    );
  }
} finally {
  await rm(fixtures, { recursive: true, force: true });
}
