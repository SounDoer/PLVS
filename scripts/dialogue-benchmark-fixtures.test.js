import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateDialogueBenchmarkFixtures,
  validateDialogueBenchmarkManifest,
} from "./dialogue-benchmark-fixtures.mjs";

const ROOT = process.cwd();
const MANIFEST = join(ROOT, "fixtures/dialogue-benchmark/manifest.json");

describe("dialogue benchmark fixtures", () => {
  let directory;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "plvs-dialogue-canonical-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it("keeps a versioned, internally consistent annotation manifest", async () => {
    const manifest = validateDialogueBenchmarkManifest(
      JSON.parse(await readFile(MANIFEST, "utf8"))
    );
    expect(manifest.corpusId).toBe("plvs-dialogue-synthetic-v1");
    expect(manifest.sources).toHaveLength(4);
    expect(manifest.cases.map(({ id }) => id)).toEqual([
      "mono-levels",
      "stereo-antiphase",
      "surround-dialogue",
      "surround-voice-like-music",
    ]);
    expect(manifest.cases[2].channelLabels).toEqual(["L", "R", "C", "LFE", "Ls", "Rs"]);
  });

  it("reproduces all four historical programme hashes without a host decoder", async () => {
    const result = await generateDialogueBenchmarkFixtures({
      outputRoot: directory,
      ffmpeg: join(directory, "no-decoder"),
    });
    expect(result.outputs.map(({ sha256 }) => sha256)).toEqual([
      "16fb255119fc9ed4090ed92d371f4387e18bc8439ab626a652c2f2082eb82dd6",
      "e2d11c16394a9a46538d2deeeb06764014b1435d9598be756dea5beeea3a3d6e",
      "bff057f193f46cdf466f00968ac46a3ea6e4a4713ee8ef07d74a232fa8fbb8a5",
      "c4d78668d75df4b0e51e019acdac0729d05c4c4978c5653317d0a4dcf438180c",
    ]);
  });

  async function modifiedManifest(mutate) {
    const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
    for (const source of manifest.sources) {
      source.path = relative(directory, join(ROOT, "fixtures/dialogue-benchmark", source.path));
      source.canonicalPcm.path = relative(
        directory,
        join(ROOT, "fixtures/dialogue-benchmark", source.canonicalPcm.path)
      );
    }
    mutate(manifest);
    const path = join(directory, "manifest.json");
    await writeFile(path, JSON.stringify(manifest));
    return {
      manifestPath: path,
      outputRoot: join(directory, "output"),
      ffmpeg: join(directory, "no-decoder"),
    };
  }

  it("still rejects changed original recordings", async () => {
    const options = await modifiedManifest((m) => {
      m.sources[0].sha256 = "0".repeat(64);
    });
    await expect(generateDialogueBenchmarkFixtures(options)).rejects.toThrow(/Source clean-a hash/);
  });

  it("refuses changed mixing recipes rather than accepting a new programme", async () => {
    const options = await modifiedManifest((m) => {
      m.cases[0].layers[0].gainDb += 0.01;
    });
    await expect(generateDialogueBenchmarkFixtures(options)).rejects.toThrow(
      /Programme mono-levels hash/
    );
  });

  it("refuses removal of canonical inputs or programme pins from the standard manifest", async () => {
    const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
    const noPcm = structuredClone(manifest);
    delete noPcm.sources[0].canonicalPcm;
    expect(() => validateDialogueBenchmarkManifest(noPcm)).toThrow("Missing canonical PCM");
    const noPin = structuredClone(manifest);
    delete noPin.cases[0].sha256;
    expect(() => validateDialogueBenchmarkManifest(noPin)).toThrow("Missing programme hash");
  });
});
