import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("build-updater-manifest", () => {
  it("merges platform descriptors into one manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "updater-manifest-"));
    const notesFile = join(dir, "notes.md");
    const winFile = join(dir, "windows.json");
    const macFile = join(dir, "macos.json");
    const outFile = join(dir, "latest.json");

    writeFileSync(notesFile, "Release notes\n");
    writeFileSync(
      winFile,
      JSON.stringify({
        platform: "windows-x86_64",
        url: "https://github.com/SounDoer/PLVS/releases/download/v0.7.0/PLVS-v0.7.0-x64-setup.nsis.zip",
        signature: "sig-win",
      })
    );
    writeFileSync(
      macFile,
      JSON.stringify({
        platform: "darwin-aarch64",
        url: "https://github.com/SounDoer/PLVS/releases/download/v0.7.0/PLVS-v0.7.0-aarch64.app.tar.gz",
        signature: "sig-mac",
      })
    );

    execFileSync("node", [
      "scripts/build-updater-manifest.mjs",
      "0.7.0",
      notesFile,
      outFile,
      winFile,
      macFile,
    ]);

    const manifest = JSON.parse(readFileSync(outFile, "utf8"));
    expect(manifest.version).toBe("0.7.0");
    expect(manifest.notes).toBe("Release notes\n");
    expect(manifest.platforms["windows-x86_64"]).toEqual({
      signature: "sig-win",
      url: "https://github.com/SounDoer/PLVS/releases/download/v0.7.0/PLVS-v0.7.0-x64-setup.nsis.zip",
    });
    expect(manifest.platforms["darwin-aarch64"].signature).toBe("sig-mac");
    expect(typeof manifest.pub_date).toBe("string");
  });
});
