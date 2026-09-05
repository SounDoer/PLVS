import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

const releaseWorkflow = readFileSync(join(cwd(), ".github", "workflows", "release.yml"), "utf8");
const devBuildWorkflow = readFileSync(
  join(cwd(), ".github", "workflows", "dev-build.yml"),
  "utf8",
);
const devBuildSkill = readFileSync(
  join(cwd(), "skills", "plvs-dev-build", "SKILL.md"),
  "utf8",
);
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

describe("Windows Portable Dev Build", () => {
  it("publishes the GUI host and CLI forwarder together in one ZIP", () => {
    expect(devBuildWorkflow).toContain('Copy-Item "src-tauri/target/release/plvs.exe"');
    expect(devBuildWorkflow).toContain('Copy-Item "src-tauri/target/release/plvs-cli.exe"');
    expect(devBuildWorkflow).toContain("Compress-Archive");
    expect(devBuildWorkflow).toContain('$portableDir = "PLVS-v${label}-x64-portable"');
    expect(devBuildWorkflow).toContain('DestinationPath "dev-dist/$portableDir.zip"');
    expect(devBuildWorkflow).not.toContain("PLVS-v${label}-x64-portable.exe");
  });

  it("documents the Portable ZIP and its two executables", () => {
    expect(devBuildSkill).toContain("PLVS-v<version>-dev.<short-sha>-x64-portable.zip");
    expect(devBuildSkill).toContain("`plvs.exe`");
    expect(devBuildSkill).toContain("`plvs-cli.exe`");
  });
});
