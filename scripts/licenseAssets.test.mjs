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
    expect(stagedNotice).toContain("FFmpeg 7.1.5 sidecars");
    expect(stagedNotice).toContain("Bundled fonts");
    expect(
      LICENSE_ASSETS.some((asset) => asset.destination === "licenses/COMPONENT-NOTICES.txt")
    ).toBe(true);
  });

  it("rejects a staged asset whose required identification was removed", async () => {
    const destination = await mkdtemp(join(tmpdir(), "plvs-license-assets-"));
    temporaryDirectories.push(destination);
    await stageLicenseAssets(destination);

    await writeFile(join(destination, "licenses", "PLVS-LICENSE.txt"), "MIT License\n");

    await expect(verifyLicenseAssets(destination)).rejects.toThrow("Copyright (c) 2026 SounDoer");
  });

  it("rejects modified notices even when all identification markers survive", async () => {
    const destination = await mkdtemp(join(tmpdir(), "plvs-license-assets-"));
    temporaryDirectories.push(destination);
    await stageLicenseAssets(destination);
    const file = join(destination, "licenses", "COMPONENT-NOTICES.txt");
    await writeFile(file, (await readFile(file, "utf8")) + "\nUnreviewed change\n");
    await expect(verifyLicenseAssets(destination)).rejects.toThrow("differs from reviewed source");
  });
});
