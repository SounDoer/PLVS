import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCanonicalDialoguePcm } from "./dialogue-benchmark-pcm.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
describe("canonical dialogue PCM integrity", () => {
  let directory, path, raw, packed, metadata;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "plvs-pcm-"));
    path = join(directory, "source.f32.gz");
    raw = Buffer.alloc(8);
    raw.writeFloatLE(0.25);
    raw.writeFloatLE(-0.5, 4);
    packed = gzipSync(raw);
    metadata = {
      sampleRateHz: 48000,
      frameCount: 2,
      sha256: hash(raw),
      compressedSha256: hash(packed),
    };
    await writeFile(path, packed);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("restores the exact mono float32 samples", async () => {
    expect(Array.from(await readCanonicalDialoguePcm(path, metadata, 48000, 2))).toEqual([
      0.25, -0.5,
    ]);
  });
  it("rejects a changed compressed source", async () => {
    packed[packed.length - 1] ^= 1;
    await writeFile(path, packed);
    await expect(readCanonicalDialoguePcm(path, metadata, 48000, 2)).rejects.toThrow(
      "compressed hash mismatch"
    );
  });
  it("independently checks the uncompressed hash", async () => {
    raw.writeFloatLE(0.3);
    packed = gzipSync(raw);
    await writeFile(path, packed);
    metadata.compressedSha256 = hash(packed);
    await expect(readCanonicalDialoguePcm(path, metadata, 48000, 2)).rejects.toThrow(
      "payload size/hash mismatch"
    );
  });
  it("refuses changed duration or sample-rate metadata", async () => {
    await expect(readCanonicalDialoguePcm(path, metadata, 44100, 2)).rejects.toThrow(
      "format does not match"
    );
    await expect(readCanonicalDialoguePcm(path, metadata, 48000, 3)).rejects.toThrow(
      "format does not match"
    );
  });
  it("rejects non-finite samples even if their hashes were recorded", async () => {
    raw.writeFloatLE(NaN);
    packed = gzipSync(raw);
    await writeFile(path, packed);
    metadata.sha256 = hash(raw);
    metadata.compressedSha256 = hash(packed);
    await expect(readCanonicalDialoguePcm(path, metadata, 48000, 2)).rejects.toThrow("Non-finite");
  });
});
