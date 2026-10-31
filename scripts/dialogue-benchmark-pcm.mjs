import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const unpack = promisify(gunzip);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Read pinned mono float32 PCM, without platform-dependent decoding or resampling. */
export async function readCanonicalDialoguePcm(path, metadata, sampleRateHz, expectedFrames) {
  if (
    !Number.isSafeInteger(expectedFrames) ||
    expectedFrames <= 0 ||
    metadata.sampleRateHz !== sampleRateHz ||
    metadata.frameCount !== expectedFrames
  ) {
    throw new Error(`Canonical PCM format does not match the source duration/sample rate: ${path}`);
  }
  const packed = await readFile(path);
  if (hash(packed) !== metadata.compressedSha256) {
    throw new Error(`Canonical PCM compressed hash mismatch: ${path}`);
  }
  const bytes = await unpack(packed, { maxOutputLength: expectedFrames * 4 });
  if (bytes.length !== expectedFrames * 4 || hash(bytes) !== metadata.sha256) {
    throw new Error(`Canonical PCM payload size/hash mismatch: ${path}`);
  }
  const samples = new Float32Array(expectedFrames);
  for (let index = 0; index < samples.length; index++) {
    const value = bytes.readFloatLE(index * 4);
    if (!Number.isFinite(value)) throw new Error(`Non-finite canonical PCM sample: ${path}`);
    samples[index] = value;
  }
  return samples;
}
