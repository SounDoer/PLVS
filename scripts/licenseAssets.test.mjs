import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { LICENSE_ASSETS } from "./license-assets.mjs";
import { stageLicenseAssets } from "./stage-license-assets.mjs";
import { verifyLicenseAssets } from "./verify-license-assets.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("release license assets", () => {
  it("stages and verifies the complete distributable payload", async () => {
    const destination = await mkdtemp(join(tmpdir(), "plvs-license-assets-"));
    temporaryDirectories.push(destination);

    await stageLicenseAssets(destination);
    await expect(verifyLicenseAssets(destination)).resolves.toBeUndefined();

    const stagedNotice = await readFile(
      join(destination, "licenses", "THIRD-PARTY-NOTICES.txt"),
      "utf8"
    );
    expect(stagedNotice).toContain("FFmpeg 7.1 sidecars");
    expect(LICENSE_ASSETS).toHaveLength(14);
  });

  it("rejects a staged asset whose required identification was removed", async () => {
    const destination = await mkdtemp(join(tmpdir(), "plvs-license-assets-"));
    temporaryDirectories.push(destination);
    await stageLicenseAssets(destination);

    await writeFile(join(destination, "licenses", "PLVS-LICENSE.txt"), "MIT License\n");

    await expect(verifyLicenseAssets(destination)).rejects.toThrow("Copyright (c) 2026 SounDoer");
  });
});
