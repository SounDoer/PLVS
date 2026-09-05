import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

const releaseWorkflow = readFileSync(join(cwd(), ".github", "workflows", "release.yml"), "utf8");
const readme = readFileSync(join(cwd(), "README.md"), "utf8");

describe("Windows Portable Release", () => {
  it("publishes the GUI host and CLI forwarder together in one ZIP", () => {
    expect(releaseWorkflow).toContain("src-tauri/target/release/plvs.exe");
    expect(releaseWorkflow).toContain("src-tauri/target/release/plvs-cli.exe");
    expect(releaseWorkflow).toContain("Compress-Archive");
    expect(releaseWorkflow).toContain("PLVS-${{ github.ref_name }}-x64-portable.zip");
    expect(releaseWorkflow).not.toContain("PLVS-${{ github.ref_name }}-x64-portable.exe");
  });

  it("documents the Portable ZIP and sibling CLI requirement", () => {
    expect(readme).toContain("PLVS_x64-portable.zip");
    expect(readme).toContain("keep `plvs-cli.exe` beside it");
  });
});
