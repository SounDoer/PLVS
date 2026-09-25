import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";
import { TAURI_LICENSE_RESOURCES } from "./license-assets.mjs";

const releaseWorkflow = readFileSync(join(cwd(), ".github", "workflows", "release.yml"), "utf8");
const previewBuildWorkflow = readFileSync(
  join(cwd(), ".github", "workflows", "preview-build.yml"),
  "utf8"
);
const upgradeCandidateWorkflow = readFileSync(
  join(cwd(), ".github", "workflows", "upgrade-candidate.yml"),
  "utf8"
);
const previewBuildSkill = readFileSync(
  join(cwd(), ".agents", "skills", "plvs-preview-build", "SKILL.md"),
  "utf8"
);
const appSource = readFileSync(join(cwd(), "src-tauri", "src", "lib.rs"), "utf8");
const packageJson = JSON.parse(readFileSync(join(cwd(), "package.json"), "utf8"));
const tauriConfig = JSON.parse(readFileSync(join(cwd(), "src-tauri", "tauri.conf.json"), "utf8"));
const previewTauriConfig = JSON.parse(
  readFileSync(join(cwd(), "src-tauri", "tauri.preview.conf.json"), "utf8")
);
const windowsInstallerSmoke = readFileSync(
  join(cwd(), "scripts", "verify-windows-installer.ps1"),
  "utf8"
);
const macosDmgSmoke = readFileSync(join(cwd(), "scripts", "verify-macos-dmg.sh"), "utf8");
const bumpVersionScript = readFileSync(join(cwd(), "scripts", "bump-version.mjs"), "utf8");

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

  it("stages the matching release CLI before every official desktop bundle", () => {
    for (const script of ["desktop:release-nsis", "desktop:release-dmg"]) {
      expect(packageJson.scripts[script]).toContain(
        "build-plvs-cli.mjs --profile release --identity release --stage"
      );
      expect(packageJson.scripts[script]).toContain("tauri.cli-sidecar.conf.json");
    }
  });

  it("builds Preview GUI and CLI with the same isolated identity", () => {
    const script = packageJson.scripts["desktop:preview-nsis"];
    expect(script).toContain("build-plvs-cli.mjs --profile release --identity preview --stage");
    expect(script).toContain("tauri.preview.conf.json");
    expect(script).toContain("--features preview-identity");
    expect(script).toContain("tauri.cli-sidecar.conf.json");
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

  it("stages and verifies license materials inside the final Portable ZIP", () => {
    expect(releaseWorkflow).toContain("node scripts/stage-license-assets.mjs $portableDir");
    expect(releaseWorkflow).toContain("node scripts/verify-license-assets.mjs $portableDir");
    expect(releaseWorkflow).toContain("scripts/verify-windows-portable.ps1");
    expect(releaseWorkflow.indexOf("scripts/verify-windows-portable.ps1")).toBeGreaterThan(
      releaseWorkflow.indexOf("Compress-Archive")
    );
  });
});

describe("Bundled license materials", () => {
  it("uses the shared license destinations in release and Preview Tauri bundles", () => {
    for (const [source, destination] of Object.entries(TAURI_LICENSE_RESOURCES)) {
      expect(tauriConfig.bundle.resources[source]).toBe(destination);
      expect(previewTauriConfig.bundle.resources[source]).toBe(destination);
    }
  });

  it("verifies installed Windows and mounted macOS package resources", () => {
    expect(windowsInstallerSmoke).toContain("scripts\\verify-license-assets.mjs");
    expect(windowsInstallerSmoke).toContain("$installRoot");
    expect(macosDmgSmoke).toContain('"$app/Contents/Resources"');
    expect(macosDmgSmoke).toContain("verify-license-assets.mjs");
  });
});

describe("Immutable Release promotion", () => {
  it("keeps version-bump guidance on the exact-SHA workflow", () => {
    expect(bumpVersionScript).toContain("npm run release:preflight");
    expect(bumpVersionScript).toContain("Dispatch release.yml");
    expect(bumpVersionScript).toContain("Do not create or push the release tag manually");
    expect(bumpVersionScript).not.toContain("git tag v${newVersion}");
    expect(bumpVersionScript.indexOf("npm run release:preflight")).toBeLessThan(
      bumpVersionScript.indexOf("git push origin main")
    );
  });

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
    expect(releaseWorkflow).toContain("--json targetCommitish");
    expect(releaseWorkflow).toContain("Draft ${TAG} moved away from the tested commit");
    expect(releaseWorkflow).not.toContain(
      'gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/${TAG}"'
    );
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

describe("Immutable Windows Preview Build", () => {
  it("publishes the GUI host and CLI forwarder together in one ZIP", () => {
    for (const name of ["plvs.exe", "plvs-cli.exe", "ffmpeg.exe", "ffprobe.exe"]) {
      expect(previewBuildWorkflow).toContain(
        `@("plvs.exe", "plvs-cli.exe", "ffmpeg.exe", "ffprobe.exe")`
      );
      expect(previewBuildSkill).toContain(`\`${name}\``);
    }
    expect(previewBuildWorkflow).toContain("Compress-Archive");
    expect(previewBuildWorkflow).toContain('$portableDir = "PLVS-Preview-v${label}-x64-portable"');
    expect(previewBuildWorkflow).toContain('DestinationPath "preview-assets/$portableDir.zip"');
    expect(previewBuildWorkflow).toContain("node scripts/stage-license-assets.mjs $portableDir");
    expect(previewBuildWorkflow).toContain("scripts/verify-windows-portable.ps1");
  });

  it("locks dispatch, tracking, and publication to an exact commit", () => {
    expect(previewBuildWorkflow).toContain("commit_sha:");
    expect(previewBuildWorkflow).toContain("request_id:");
    expect(previewBuildWorkflow).toContain("ref: ${{ inputs.commit_sha }}");
    expect(previewBuildWorkflow).toContain("npm run check");
    expect(previewBuildWorkflow).toContain("npm run smoke:file-analysis");
    expect(previewBuildWorkflow).toContain("npm run desktop:verify-windows-preview-installer");
    expect(previewBuildWorkflow).toContain("preview-${short_sha}-${GITHUB_RUN_ID}");
    expect(previewBuildSkill).toContain("--commit $sha --event workflow_dispatch");
  });

  it("installs the Linux system dependencies required by the repository gate", () => {
    expect(previewBuildWorkflow).toContain(
      "Install Linux dependencies (Tauri / WebKit / audio)"
    );
    for (const dependency of [
      "libasound2-dev",
      "libwebkit2gtk-4.1-dev",
      "libgtk-3-dev",
      "libayatana-appindicator3-dev",
      "librsvg2-dev",
      "patchelf",
    ]) {
      expect(previewBuildWorkflow).toContain(dependency);
    }
  });

  it("publishes a verified immutable Draft instead of overwriting a rolling release", () => {
    expect(previewBuildWorkflow).toContain("node scripts/validate-preview-bundle.mjs");
    expect(previewBuildWorkflow).toContain("--draft");
    expect(previewBuildWorkflow).toContain("--prerelease");
    expect(previewBuildWorkflow).toContain("--draft=false --prerelease --latest=false");
    expect(previewBuildWorkflow).toContain("--json targetCommitish");
    expect(previewBuildWorkflow).toContain("Draft ${TAG} moved away from the tested commit");
    expect(previewBuildWorkflow).not.toContain(
      'gh api "repos/${GITHUB_REPOSITORY}/git/ref/tags/${TAG}"'
    );
    expect(previewBuildWorkflow).toContain("gh release verify");
    expect(previewBuildWorkflow).toContain(".immutable");
    expect(previewBuildWorkflow).toContain(".[10:][] | .tag_name");
    expect(previewBuildWorkflow).not.toContain("softprops/action-gh-release");
    expect(previewBuildWorkflow).not.toContain("gh release delete dev");
  });

  it("keeps write permission out of validation and package builds", () => {
    expect(previewBuildWorkflow).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(previewBuildWorkflow).toMatch(
      /prepare-draft:[\s\S]*?permissions:\s*\n\s*contents: write/
    );
    expect(previewBuildWorkflow).toMatch(
      /publish-preview:[\s\S]*?permissions:\s*\n\s*contents: write/
    );
  });

  it("compiles the updater out of Preview packages", () => {
    expect(appSource).toContain('#[cfg(not(feature = "preview-identity"))]');
    expect(appSource).toContain("tauri_plugin_updater::Builder::new().build()");
  });
});

describe("private upgrade candidate", () => {
  it("builds signed production-identity packages for both platforms", () => {
    expect(upgradeCandidateWorkflow).toContain("npm run desktop:release-nsis");
    expect(upgradeCandidateWorkflow).toContain("npm run desktop:release-dmg");
    expect(upgradeCandidateWorkflow).toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(upgradeCandidateWorkflow).toContain("updater-windows.json");
    expect(upgradeCandidateWorkflow).toContain("updater-macos.json");
  });

  it("cannot create a public tag or Release", () => {
    expect(upgradeCandidateWorkflow).toMatch(/permissions:\s*\n\s*contents: read/);
    expect(upgradeCandidateWorkflow).not.toContain("contents: write");
    expect(upgradeCandidateWorkflow).not.toContain("gh release create");
    expect(upgradeCandidateWorkflow).not.toContain("git tag");
  });

  it("stamps and gates the requested candidate version", () => {
    expect(upgradeCandidateWorkflow).toContain('node scripts/bump-version.mjs "$VERSION"');
    expect(upgradeCandidateWorkflow).toContain("npm run check");
    expect(upgradeCandidateWorkflow).toContain("build-upgrade-test-manifest.mjs");
  });
});
