import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = join(ROOT, "fixtures/dialogue-benchmark/manifest.json");
const OUTPUT_ROOT = join(ROOT, "artifacts/dialogue-benchmark/corpus");
const SAMPLE_BYTES = 4;

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function gain(db) {
  return 10 ** (db / 20);
}

function findFfmpeg() {
  if (process.env.PLVS_FFMPEG) return process.env.PLVS_FFMPEG;
  const name =
    process.platform === "win32"
      ? "ffmpeg-x86_64-pc-windows-msvc.exe"
      : process.platform === "darwin"
        ? "ffmpeg-aarch64-apple-darwin"
        : "ffmpeg-x86_64-unknown-linux-gnu";
  return join(ROOT, "src-tauri/binaries", name);
}

function wavHeader(frameCount, channelCount, sampleRateHz) {
  const dataBytes = frameCount * channelCount * SAMPLE_BYTES;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(channelCount, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(sampleRateHz * channelCount * SAMPLE_BYTES, 28);
  header.writeUInt16LE(channelCount * SAMPLE_BYTES, 32);
  header.writeUInt16LE(SAMPLE_BYTES * 8, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

function decodeMono(ffmpeg, path, sampleRateHz) {
  const result = spawnSync(
    ffmpeg,
    ["-v", "error", "-i", path, "-ar", String(sampleRateHz), "-ac", "1", "-f", "f32le", "-"],
    { encoding: null, maxBuffer: 64 * 1024 * 1024 }
  );
  if (result.status !== 0) {
    throw new Error(Buffer.from(result.stderr ?? []).toString("utf8") || `Unable to decode ${path}`);
  }
  const buffer = Buffer.from(result.stdout);
  const samples = new Float32Array(buffer.byteLength / SAMPLE_BYTES);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = buffer.readFloatLE(index * SAMPLE_BYTES);
  }
  return samples;
}

function deterministicNoise(frame, sampleRateHz) {
  let value = (Math.imul(frame + 1, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  const white = ((value >>> 0) / 0xffffffff) * 2 - 1;
  const slow = Math.sin((2 * Math.PI * 37 * frame) / sampleRateHz);
  return white * 0.82 + slow * 0.18;
}

function musicSample(frame, sampleRateHz) {
  const time = frame / sampleRateHz;
  const tremolo = 0.72 + 0.28 * Math.sin(2 * Math.PI * 2.3 * time);
  return (
    tremolo *
    (0.42 * Math.sin(2 * Math.PI * 220 * time) +
      0.33 * Math.sin(2 * Math.PI * 277.18 * time) +
      0.25 * Math.sin(2 * Math.PI * 329.63 * time))
  );
}

function lfeSample(frame, sampleRateHz) {
  const time = frame / sampleRateHz;
  return 0.78 * Math.sin(2 * Math.PI * 54 * time) + 0.22 * Math.sin(2 * Math.PI * 89 * time);
}

function voiceMusicSample(frame, sampleRateHz) {
  const time = frame / sampleRateHz;
  const phase =
    2 * Math.PI * (145 * time - (34 / (2 * Math.PI * 0.72)) * Math.cos(2 * Math.PI * 0.72 * time));
  const syllable = Math.max(0, Math.sin(2 * Math.PI * 2.7 * time)) ** 0.65;
  let value = 0;
  for (let harmonic = 1; harmonic <= 18; harmonic += 1) {
    const frequency = harmonic * (145 + 34 * Math.sin(2 * Math.PI * 0.72 * time));
    const formant =
      Math.exp(-Math.pow((frequency - 720) / 260, 2)) +
      0.7 * Math.exp(-Math.pow((frequency - 1250) / 380, 2)) +
      0.35 * Math.exp(-Math.pow((frequency - 2500) / 520, 2));
    value += (formant / harmonic) * Math.sin(harmonic * phase);
  }
  return value * syllable * 0.42;
}

export function validateDialogueBenchmarkManifest(manifest) {
  if (manifest?.schemaVersion !== 1) throw new Error("Dialogue benchmark schemaVersion must be 1.");
  if (!Number.isInteger(manifest.sampleRateHz) || manifest.sampleRateHz <= 0) {
    throw new Error("Dialogue benchmark sampleRateHz must be a positive integer.");
  }
  const sourceIds = new Set();
  for (const source of manifest.sources ?? []) {
    if (!source.id || sourceIds.has(source.id)) throw new Error(`Duplicate source id: ${source.id}`);
    if (!/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error(`Invalid source hash: ${source.id}`);
    sourceIds.add(source.id);
  }
  const caseIds = new Set();
  for (const fixture of manifest.cases ?? []) {
    if (!fixture.id || caseIds.has(fixture.id)) throw new Error(`Duplicate case id: ${fixture.id}`);
    if (!Array.isArray(fixture.channelLabels) || fixture.channelLabels.length === 0) {
      throw new Error(`Case ${fixture.id} has no channel labels.`);
    }
    for (const layer of fixture.layers ?? []) {
      if (layer.channels?.length !== fixture.channelLabels.length) {
        throw new Error(`Layer channel count does not match case ${fixture.id}.`);
      }
      if (layer.kind === "source" && !sourceIds.has(layer.sourceId)) {
        throw new Error(`Unknown source ${layer.sourceId} in case ${fixture.id}.`);
      }
    }
    caseIds.add(fixture.id);
  }
  return manifest;
}

export async function generateDialogueBenchmarkFixtures({
  manifestPath = MANIFEST_PATH,
  outputRoot = OUTPUT_ROOT,
  ffmpeg = findFfmpeg(),
} = {}) {
  const manifestBytes = await readFile(manifestPath);
  const manifest = validateDialogueBenchmarkManifest(JSON.parse(manifestBytes.toString("utf8")));
  const fixtureRoot = dirname(manifestPath);
  const sources = new Map();
  for (const source of manifest.sources) {
    const path = join(fixtureRoot, source.path);
    const bytes = await readFile(path);
    const actualHash = sha256(bytes);
    if (actualHash !== source.sha256) {
      throw new Error(`Source ${source.id} hash ${actualHash} does not match ${source.sha256}.`);
    }
    const pcm = decodeMono(ffmpeg, path, manifest.sampleRateHz);
    const expectedFrames = Math.round((source.durationMs * manifest.sampleRateHz) / 1000);
    if (pcm.length !== expectedFrames) {
      throw new Error(`Source ${source.id} has ${pcm.length} frames; expected ${expectedFrames}.`);
    }
    sources.set(source.id, pcm);
  }

  await mkdir(outputRoot, { recursive: true });
  const outputs = [];
  for (const fixture of manifest.cases) {
    const channels = fixture.channelLabels.length;
    const frames = Math.round((fixture.durationMs * manifest.sampleRateHz) / 1000);
    const pcm = new Float32Array(frames * channels);
    for (const layer of fixture.layers) {
      const startFrame = Math.round((layer.startMs * manifest.sampleRateHz) / 1000);
      const endFrame =
        layer.kind === "source"
          ? Math.min(frames, startFrame + sources.get(layer.sourceId).length)
          : Math.min(frames, Math.round((layer.endMs * manifest.sampleRateHz) / 1000));
      const scale = gain(layer.gainDb);
      for (let frame = startFrame; frame < endFrame; frame += 1) {
        const sourceFrame = frame - startFrame;
        const sample =
          layer.kind === "source"
            ? sources.get(layer.sourceId)[sourceFrame]
            : layer.kind === "music"
              ? musicSample(frame, manifest.sampleRateHz)
              : layer.kind === "lfe"
                ? lfeSample(frame, manifest.sampleRateHz)
                : layer.kind === "voiceMusic"
                  ? voiceMusicSample(frame, manifest.sampleRateHz)
                  : deterministicNoise(frame, manifest.sampleRateHz);
        for (let channel = 0; channel < channels; channel += 1) {
          pcm[frame * channels + channel] += sample * scale * layer.channels[channel];
        }
      }
    }

    let peak = 0;
    for (const sample of pcm) peak = Math.max(peak, Math.abs(sample));
    const targetPeak = gain(fixture.peakDbfs);
    const normalization = peak > 0 ? targetPeak / peak : 1;
    const payload = Buffer.allocUnsafe(pcm.length * SAMPLE_BYTES);
    for (let index = 0; index < pcm.length; index += 1) {
      payload.writeFloatLE(pcm[index] * normalization, index * SAMPLE_BYTES);
    }
    const wav = Buffer.concat([
      wavHeader(frames, channels, manifest.sampleRateHz),
      payload,
    ]);
    const fileName = `${fixture.id}.wav`;
    await writeFile(join(outputRoot, fileName), wav);
    outputs.push({
      id: fixture.id,
      path: fileName,
      sha256: sha256(wav),
      frameCount: frames,
      channelLabels: fixture.channelLabels,
      peakNormalization: normalization,
    });
  }

  const resolved = {
    ...manifest,
    manifestSha256: sha256(manifestBytes),
    generatedAt: null,
    outputs,
  };
  await writeFile(join(outputRoot, "manifest.resolved.json"), `${JSON.stringify(resolved, null, 2)}\n`);
  return resolved;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await generateDialogueBenchmarkFixtures();
  process.stdout.write(`${JSON.stringify({ corpusId: result.corpusId, outputs: result.outputs }, null, 2)}\n`);
}
