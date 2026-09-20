import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

const releaseWorkflow = readFileSync(join(cwd(), ".github", "workflows", "release.yml"), "utf8");
const devBuildWorkflow = readFileSync(join(cwd(), ".github", "workflows", "dev-build.yml"), "utf8");
const devBuildSkill = readFileSync(join(cwd(), "skills", "plvs-dev-build", "SKILL.md"), "utf8");
const packageJson = JSON.parse(readFileSync(join(cwd(), "package.json"), "utf8"));

describe("CLI packaging", () => {
  it("stages the development identity for local desktop commands", () => {
    expect(packageJson.scripts.desktop).toContain(
      "build-plvs-cli.mjs --profile debug --identity development --stage"
    );
    expect(packageJson.scripts["desktop:build"]).toContain(
      "build-plvs-cli.mjs --profile release --identity development --stage"
    );
    expect(packageJson.scripts.desktop).toContain("tauri.cli-sidecar.conf.json");
    expect(packageJson.scripts["desktop:build"]).toContain("tauri.cli-sidecar.conf.json");
  });

  it("stages the matching release CLI before every desktop bundle", () => {
    for (const script of ["desktop:dev-nsis", "desktop:release-nsis", "desktop:release-dmg"]) {
      expect(packageJson.scripts[script]).toContain(
        "build-plvs-cli.mjs --profile release --identity release --stage"
      );
      expect(packageJson.scripts[script]).toContain("tauri.cli-sidecar.conf.json");
    }
  });
});

describe("Windows Portable Release", () => {
  it("publishes the GUI host and CLI forwarder together in one ZIP", () => {
    expect(releaseWorkflow).toContain('@("plvs.exe", "plvs-cli.exe", "ffmpeg.exe", "ffprobe.exe")');
    expect(releaseWorkflow).toContain('$src = "src-tauri/target/release/$name"');
    expect(releaseWorkflow).toContain("Compress-Archive");
    expect(releaseWorkflow).toContain('$portableDir = "PLVS-$env:TAG-x64-portable"');
    expect(releaseWorkflow).not.toContain("x64-portable.exe");
  });

  it("publishes the portable and macOS packages under the shared release asset names", () => {
    expect(releaseWorkflow).toContain('"PLVS-$env:TAG-x64-portable"');
    expect(releaseWorkflow).toContain('"$asset_dir/PLVS-${TAG}-aarch64.dmg"');
  });
});

describe("Immutable Release promotion", () => {
  it("dispatches an exact version and commit instead of rebuilding from a pushed tag", () => {
    expect(releaseWorkflow).toContain("workflow_dispatch:");
    expect(releaseWorkflow).toContain("version:");
    expect(releaseWorkflow).toContain("commit_sha:");
    expect(releaseWorkflow).toContain("confirm_immutable_releases:");
    expect(releaseWorkflow).not.toMatch(/push:\s*\n\s*tags:/);
    expect(releaseWorkflow).toContain("Require successful CI for the exact commit");
    expect(releaseWorkflow).toContain("commit_sha is not the current tip of origin/main");
  });

  it("builds each platform once and promotes those tested artifacts", () => {
    expect(releaseWorkflow.match(/npm run desktop:release-nsis/g)).toHaveLength(1);
    expect(releaseWorkflow.match(/npm run desktop:release-dmg/g)).toHaveLength(1);
    expect(releaseWorkflow).toContain("release-candidate-windows");
    expect(releaseWorkflow).toContain("release-candidate-macos");
    expect(releaseWorkflow).toContain("node scripts/validate-release-bundle.mjs");
  });

  it("assembles a complete draft and publishes it only from the final job", () => {
    expect(releaseWorkflow).toContain('gh release create "$TAG" release-assets/*');
    expect(releaseWorkflow).toContain("--draft");
    expect(releaseWorkflow).toContain('gh release edit "$TAG"');
    expect(releaseWorkflow).toContain("--draft=false --latest");
    expect(releaseWorkflow).toContain("Draft tag ${TAG} moved away from the tested commit");
    expect(releaseWorkflow).toContain("gh release verify");
    expect(releaseWorkflow).toContain(".immutable");
    expect(releaseWorkflow).not.toContain("softprops/action-gh-release");
  });

  it("keeps write permissions out of validation and platform builds", () => {
    expect(releaseWorkflow).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(releaseWorkflow).toMatch(/prepare-draft:[\s\S]*?permissions:\s*\n\s*contents: write/);
    expect(releaseWorkflow).toMatch(/publish-release:[\s\S]*?permissions:\s*\n\s*contents: write/);
  });
});

describe("Windows Portable Dev Build", () => {
  it("publishes the GUI host and CLI forwarder together in one ZIP", () => {
    expect(devBuildWorkflow).toContain('Copy-Item "src-tauri/target/release/plvs.exe"');
    expect(devBuildWorkflow).toContain('Copy-Item "src-tauri/target/release/plvs-cli.exe"');
    expect(devBuildWorkflow).toContain('Copy-Item "src-tauri/target/release/ffmpeg.exe"');
    expect(devBuildWorkflow).toContain('Copy-Item "src-tauri/target/release/ffprobe.exe"');
    expect(devBuildWorkflow).toContain("Compress-Archive");
    expect(devBuildWorkflow).toContain('$portableDir = "PLVS-v${label}-x64-portable"');
    expect(devBuildWorkflow).toContain('DestinationPath "dev-dist/$portableDir.zip"');
    expect(devBuildWorkflow).not.toContain("PLVS-v${label}-x64-portable.exe");
  });

  it("documents the Portable ZIP and its two executables", () => {
    expect(devBuildSkill).toContain("PLVS-v<version>-dev.<short-sha>-x64-portable.zip");
    expect(devBuildSkill).toContain("`plvs.exe`");
    expect(devBuildSkill).toContain("`plvs-cli.exe`");
    expect(devBuildSkill).toContain("`ffmpeg.exe`");
    expect(devBuildSkill).toContain("`ffprobe.exe`");
    expect(devBuildSkill).toContain("keep all extracted files together");
  });
});
