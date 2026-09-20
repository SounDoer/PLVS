import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { releaseAssetNames } from "./release-assets.mjs";
import { validateReleaseBundle } from "./validate-release-bundle.mjs";

function createBundle(version = "1.2.3") {
  const directory = mkdtempSync(join(tmpdir(), "plvs-release-bundle-"));
  const names = releaseAssetNames(version);
  mkdirSync(directory, { recursive: true });

  for (const asset of [
    names.windowsInstaller,
    names.windowsPortable,
    names.macosDmg,
    names.macosUpdater,
  ]) {
    writeFileSync(join(directory, asset), "candidate", "utf8");
  }

  writeFileSync(
    join(directory, names.updaterManifest),
    JSON.stringify({
      version,
      platforms: {
        "windows-x86_64": {
          signature: "windows-signature",
          url: `https://github.com/SounDoer/PLVS/releases/download/v${version}/${names.windowsInstaller}`,
        },
        "darwin-aarch64": {
          signature: "macos-signature",
          url: `https://github.com/SounDoer/PLVS/releases/download/v${version}/${names.macosUpdater}`,
        },
      },
    }),
    "utf8"
  );

  return { directory, names };
}

describe("release bundle validation", () => {
  it("accepts the complete immutable release asset set", () => {
    const { directory } = createBundle();
    expect(() => validateReleaseBundle("1.2.3", directory)).not.toThrow();
  });

  it("rejects a partial release before it can be published", () => {
    const { directory, names } = createBundle();
    rmSync(join(directory, names.macosDmg));
    expect(() => validateReleaseBundle("1.2.3", directory)).toThrow("Release asset set mismatch");
  });

  it("rejects updater URLs that do not point to the staged immutable asset", () => {
    const { directory, names } = createBundle();
    const manifestPath = join(directory, names.updaterManifest);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.platforms["windows-x86_64"].url = "https://example.com/wrong.exe";
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    expect(() => validateReleaseBundle("1.2.3", directory)).toThrow(
      "Unexpected windows-x86_64 updater URL"
    );
  });
});
