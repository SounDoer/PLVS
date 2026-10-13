import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  generateDialogueBenchmarkFixtures,
  validateDialogueBenchmarkManifest,
} from "./dialogue-benchmark-fixtures.mjs";

const ROOT = process.cwd();
const MANIFEST = join(ROOT, "fixtures/dialogue-benchmark/manifest.json");

describe("dialogue benchmark fixtures", () => {
  it("keeps a versioned, internally consistent annotation manifest", async () => {
    const manifest = validateDialogueBenchmarkManifest(JSON.parse(await readFile(MANIFEST, "utf8")));
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

  it("generates byte-identical programme fixtures from the attributed sources", async () => {
    const first = await generateDialogueBenchmarkFixtures();
    const second = await generateDialogueBenchmarkFixtures();
    expect(second.outputs).toEqual(first.outputs);
    expect(first.outputs.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256))).toBe(true);
  });
});
