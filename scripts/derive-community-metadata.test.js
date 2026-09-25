import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPack } from "../src/transfer/packShape.js";
import { deriveCommunityMetadataFile } from "./derive-community-metadata.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Community metadata command", () => {
  it("derives the static Catalogue input from a validated file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "plvs-community-metadata-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "broadcast.plvsloudness");
    const pack = buildPack("loudness", [
      {
        id: "broadcast",
        name: "Broadcast",
        referenceLufs: -23,
        rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
      },
    ]);
    writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`);

    await expect(deriveCommunityMetadataFile(path)).resolves.toMatchObject({
      metadataVersion: 1,
      content: { type: "loudness", title: "Broadcast" },
      artifact: { fileName: "broadcast.plvsloudness" },
    });
  });
});
