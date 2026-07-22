import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "changelog-release-body.mjs");

function run(version, outFile, ...args) {
  return execFileSync(process.execPath, [script, version, outFile, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
}

describe("changelog-release-body", () => {
  it("keeps installation instructions in the default GitHub Release body", () => {
    const dir = mkdtempSync(join(tmpdir(), "release-body-"));
    const outFile = join(dir, "release.md");

    run("v0.9.4", outFile);

    const body = readFileSync(outFile, "utf8");
    expect(body).toContain("### Added");
    expect(body).toContain("## 安装");
    expect(body).toContain("## Installation");
  });

  it("writes only the tagged changelog section in changelog-only mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "updater-notes-"));
    const outFile = join(dir, "updater.md");

    run("v0.9.4", outFile, "--changelog-only");

    const body = readFileSync(outFile, "utf8");
    expect(body).toContain("### Added");
    expect(body).not.toContain("## 安装");
    expect(body).not.toContain("## Installation");
  });

  it("fails changelog-only generation when the tagged section is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "updater-notes-missing-"));
    const outFile = join(dir, "updater.md");

    expect(() => run("v999.999.999", outFile, "--changelog-only")).toThrow();
    expect(existsSync(outFile)).toBe(false);
  });
});
