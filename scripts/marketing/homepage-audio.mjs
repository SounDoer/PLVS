import { createHash } from "node:crypto";

export const SAMPLE_RATE_HZ = 48_000;

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** A 44-byte header for interleaved IEEE float32 PCM. */
export function floatWavHeader(frameCount, channels, sampleRateHz = SAMPLE_RATE_HZ) {
  const dataBytes = frameCount * channels * 4;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // WAVE_FORMAT_IEEE_FLOAT
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(sampleRateHz * channels * 4, 28);
  header.writeUInt16LE(channels * 4, 32);
  header.writeUInt16LE(32, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/** Interleaved float samples as a WAV file buffer. */
export function floatWav(samples, channels, sampleRateHz = SAMPLE_RATE_HZ) {
  if (samples.length % channels !== 0) throw new Error("Samples do not fill whole frames.");
  return Buffer.concat([
    floatWavHeader(samples.length / channels, channels, sampleRateHz),
    Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
  ]);
}
