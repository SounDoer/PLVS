import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts", "build-upgrade-test-manifest.mjs");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "plvs-upgrade-manifest-"));
  const notes = join(dir, "notes.md");
  const windows = join(dir, "windows.json");
  const macos = join(dir, "macos.json");
  const output = join(dir, "latest.json");
  writeFileSync(notes, "Private candidate", "utf8");
  writeFileSync(
    windows,
    JSON.stringify({
      platform: "windows-x86_64",
      asset: "PLVS_0.16.1_x64-setup.exe",
      signature: "windows-signature",
    }),
    "utf8"
  );
  writeFileSync(
    macos,
    JSON.stringify({
      platform: "darwin-aarch64",
      asset: "PLVS.app.tar.gz",
      signature: "macos-signature",
    }),
    "utf8"
  );
  return { notes, windows, macos, output };
}

describe("build-upgrade-test-manifest", () => {
  it("materializes signed assets below a private HTTPS base URL", () => {
    const files = fixture();
    execFileSync(
      process.execPath,
      [
        script,
        "0.16.1",
        "https://upgrade-lab.invalid/candidate",
        files.notes,
        files.output,
        files.windows,
        files.macos,
      ],
      { stdio: "pipe" }
    );

    const manifest = JSON.parse(readFileSync(files.output, "utf8"));
    expect(manifest.version).toBe("0.16.1");
    expect(manifest.notes).toBe("Private candidate");
    expect(manifest.platforms).toEqual({
      "windows-x86_64": {
        signature: "windows-signature",
        url: "https://upgrade-lab.invalid/candidate/PLVS_0.16.1_x64-setup.exe",
      },
      "darwin-aarch64": {
        signature: "macos-signature",
        url: "https://upgrade-lab.invalid/candidate/PLVS.app.tar.gz",
      },
    });
  });

  it("refuses insecure servers and descriptor paths", () => {
    const files = fixture();
    expect(() =>
      execFileSync(
        process.execPath,
        [script, "0.16.1", "http://localhost", files.notes, files.output, files.windows],
        { stdio: "pipe" }
      )
    ).toThrow();

    writeFileSync(
      files.windows,
      JSON.stringify({
        platform: "windows-x86_64",
        asset: "../installer.exe",
        signature: "signature",
      }),
      "utf8"
    );
    expect(() =>
      execFileSync(
        process.execPath,
        [script, "0.16.1", "https://localhost", files.notes, files.output, files.windows],
        { stdio: "pipe" }
      )
    ).toThrow();
  });
});
