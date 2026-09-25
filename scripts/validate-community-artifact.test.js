import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPack } from "../src/transfer/packShape.js";
import { validateCommunityArtifactFile } from "./validate-community-artifact.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function tempArtifact(name, contents) {
  const directory = mkdtempSync(join(tmpdir(), "plvs-community-artifact-"));
  temporaryDirectories.push(directory);
  const path = join(directory, name);
  writeFileSync(path, contents);
  return path;
}

describe("Community artifact CI entry point", () => {
  it("validates a repository artifact and returns its exact file identity", async () => {
    const pack = buildPack("loudness", [
      {
        id: "broadcast",
        name: "Broadcast",
        referenceLufs: -23,
        rules: [{ metricId: "truePeak", op: ">", value: -1, severity: "fail" }],
      },
    ]);
    const contents = `${JSON.stringify(pack, null, 2)}\n`;
    const path = tempArtifact("broadcast.plvsloudness", contents);

    await expect(validateCommunityArtifactFile(path)).resolves.toMatchObject({
      valid: true,
      type: "loudness",
      artifact: { fileName: "broadcast.plvsloudness", byteLength: Buffer.byteLength(contents) },
    });
  });

  it("rejects invalid UTF-8 before JSON parsing", async () => {
    const path = tempArtifact("broken.plvsloudness", Buffer.from([0xc3, 0x28]));
    await expect(validateCommunityArtifactFile(path)).rejects.toThrow("valid UTF-8");
  });
});
