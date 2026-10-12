import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";

export const SURROUND_51_RECIPE_VERSION = 1;
export const SURROUND_51_CHANNEL_LABELS = Object.freeze(["L", "R", "C", "LFE", "Ls", "Rs"]);

const SAMPLE_RATE_HZ = 48_000;
const CHANNEL_COUNT = SURROUND_51_CHANNEL_LABELS.length;
const BYTES_PER_SAMPLE = 4;

function wavHeader(frameCount) {
  const dataBytes = frameCount * CHANNEL_COUNT * BYTES_PER_SAMPLE;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // WAVE_FORMAT_IEEE_FLOAT
  header.writeUInt16LE(CHANNEL_COUNT, 22);
  header.writeUInt32LE(SAMPLE_RATE_HZ, 24);
  header.writeUInt32LE(SAMPLE_RATE_HZ * CHANNEL_COUNT * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(CHANNEL_COUNT * BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

/** Build the exact six-channel PCM payload used by the deterministic preview fixture. */
export function deriveSurround51Pcm(stereoPcm, { sampleRateHz = SAMPLE_RATE_HZ } = {}) {
  if (!Buffer.isBuffer(stereoPcm) || stereoPcm.byteLength % (2 * BYTES_PER_SAMPLE) !== 0) {
    throw new Error("The Sharesets preview source must be interleaved stereo Float32 PCM.");
  }
  const frameCount = stereoPcm.byteLength / (2 * BYTES_PER_SAMPLE);
  const output = Buffer.allocUnsafe(frameCount * CHANNEL_COUNT * BYTES_PER_SAMPLE);
  const leftDelayFrames = Math.round(sampleRateHz * 0.02);
  const rightDelayFrames = Math.round(sampleRateHz * 0.03);
  const lowPassAlpha = 1 - Math.exp((-2 * Math.PI * 120) / sampleRateHz);
  let lowPass = 0;

  const readStereo = (frame, channel) => stereoPcm.readFloatLE((frame * 2 + channel) * 4);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const left = readStereo(frame, 0);
    const right = readStereo(frame, 1);
    const mono = (left + right) * 0.5;
    lowPass += lowPassAlpha * (mono - lowPass);
    const surroundLeft = frame >= leftDelayFrames ? readStereo(frame - leftDelayFrames, 0) : 0;
    const surroundRight = frame >= rightDelayFrames ? readStereo(frame - rightDelayFrames, 1) : 0;
    const hotRight = Math.max(-0.97, Math.min(0.97, right * 1.34));
    const channels = [
      left,
      hotRight,
      mono * 0.7,
      lowPass * 0.4,
      surroundLeft * 0.35,
      surroundRight * 0.45,
    ];
    for (let channel = 0; channel < CHANNEL_COUNT; channel += 1) {
      output.writeFloatLE(channels[channel], (frame * CHANNEL_COUNT + channel) * 4);
    }
  }
  return output;
}

/** Decode the attributed source with PLVS's bundled sidecar, then write a temporary 5.1 WAV. */
export async function buildDerivedSurround51Wav({ ffmpegPath, sourcePath, outputPath }) {
  const rawPath = `${outputPath}.stereo.f32le`;
  try {
    const result = spawnSync(
      ffmpegPath,
      [
        "-v",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-map",
        "0:a:0",
        "-ar",
        String(SAMPLE_RATE_HZ),
        "-ac",
        "2",
        "-c:a",
        "pcm_f32le",
        "-f",
        "f32le",
        rawPath,
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || "Unable to decode the Sharesets preview source.");
    }
    const stereoPcm = await readFile(rawPath);
    const surroundPcm = deriveSurround51Pcm(stereoPcm);
    await writeFile(outputPath, Buffer.concat([wavHeader(stereoPcm.byteLength / 8), surroundPcm]));
  } finally {
    await rm(rawPath, { force: true });
  }
}
