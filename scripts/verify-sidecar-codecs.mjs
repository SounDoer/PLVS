#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [sidecarArgument, fixtureArgument] = process.argv.slice(2);
if (!sidecarArgument || !fixtureArgument) {
  throw new Error("Usage: verify-sidecar-codecs.mjs <sidecar-directory> <fixture-directory>");
}
const suffix = process.platform === "win32" ? ".exe" : "";
const sidecars = resolve(sidecarArgument);
const fixtures = resolve(fixtureArgument);
const ffmpeg = join(sidecars, `ffmpeg${suffix}`);
const ffprobe = join(sidecars, `ffprobe${suffix}`);
const manifest = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8"));

function run(program, args, encoding = null) {
  const result = spawnSync(program, args, { encoding, maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
  if (result.status !== 0) {
    throw new Error(`${program} failed: ${result.stderr || result.error || result.status}`);
  }
  return result.stdout;
}

for (const fixture of manifest.fixtures) {
  const path = join(fixtures, fixture);
  const probe = JSON.parse(
    run(ffprobe, ["-v", "error", "-show_streams", "-of", "json", path], "utf8")
  );
  if (probe.streams?.[0]?.channels !== manifest.channels) {
    throw new Error(`${fixture}: ffprobe returned the wrong channel count`);
  }
  const pcm = run(ffmpeg, [
    "-nostdin",
    "-v",
    "error",
    "-i",
    path,
    "-map",
    "0:a:0",
    "-vn",
    "-f",
    "f32le",
    "pipe:1",
  ]);
  const minimumBytes = Math.floor(manifest.sampleRate * 0.9) * manifest.channels * 4;
  if (pcm.length < minimumBytes || pcm.length % 4 !== 0) {
    throw new Error(`${fixture}: decoder returned incomplete PCM`);
  }
  let audible = false;
  for (let offset = 0; offset < pcm.length; offset += 4) {
    const sample = pcm.readFloatLE(offset);
    if (!Number.isFinite(sample)) throw new Error(`${fixture}: decoder returned non-finite PCM`);
    if (Math.abs(sample) > 0.01) audible = true;
  }
  if (!audible) throw new Error(`${fixture}: decoder returned silence`);
  console.log(`${fixture}: ${pcm.length / 4} samples decoded`);
}
