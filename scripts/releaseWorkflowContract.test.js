import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { TAURI_LICENSE_RESOURCES } from "./license-assets.mjs";

const releaseWorkflow = readFileSync(join(cwd(), ".github", "workflows", "release.yml"), "utf8");
const releaseJobs = parse(releaseWorkflow).jobs;
const prepareDraftNeeds = releaseJobs["prepare-draft"].needs;
const DRAFT_GATES = [
  "build-windows",
  "build-macos",
  "build-linux",
  "capture-acceptance",
  "release-package-smoke",
  "update-acceptance",
];
const releasePackageSmokeWorkflow = readFileSync(
  join(cwd(), ".github", "workflows", "release-package-smoke.yml"),
  "utf8"
);
const updateAcceptanceWorkflow = readFileSync(
  join(cwd(), ".github", "workflows", "update-acceptance.yml"),
  "utf8"
);
const previewBuildWorkflow = readFileSync(
  join(cwd(), ".github", "workflows", "preview-build.yml"),
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
const macosSigningSetup = readFileSync(join(cwd(), "scripts", "prepare-macos-signing.sh"), "utf8");
const macosDmgNotarization = readFileSync(join(cwd(), "scripts", "notarize-macos-dmg.sh"), "utf8");
const bumpVersionScript = readFileSync(join(cwd(), "scripts", "bump-version.mjs"), "utf8");

describe("CLI packaging", () => {
  it("stages the dev identity for local desktop commands", () => {
    expect(packageJson.scripts["desktop:dev"]).toContain(
      "build-plvs-cli.mjs --profile debug --identity dev --stage"
    );
    expect(packageJson.scripts["desktop:dev-optimized"]).toContain(
      "build-plvs-cli.mjs --profile release --identity dev --stage"
    );
    expect(packageJson.scripts["desktop:dev"]).toContain("tauri.cli-sidecar.conf.json");
    expect(packageJson.scripts["desktop:dev-optimized"]).toContain("tauri.cli-sidecar.conf.json");
  });

  it("stages the matching stable CLI before every stable desktop bundle", () => {
    for (const script of ["desktop:stable-nsis", "desktop:stable-dmg"]) {
      expect(packageJson.scripts[script]).toContain(
        "build-plvs-cli.mjs --profile release --identity stable --stage"
      );
      expect(packageJson.scripts[script]).toContain("tauri.cli-sidecar.conf.json");
    }
    expect(packageJson.scripts["desktop:stable-deb"]).toContain("build-linux-deb.mjs stable");
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

  it("publishes the portable, macOS, and Linux packages under the shared release asset names", () => {
    expect(releaseWorkflow).toContain('"PLVS-$env:TAG-x64-portable"');
    expect(releaseWorkflow).toContain('"$asset_dir/PLVS-${TAG}-aarch64.dmg"');
    expect(releaseWorkflow).toContain(
      '"release-candidate/linux/release-assets/PLVS_${VERSION}_amd64.deb"'
    );
  });

  it("signs the tested Linux deb for a version-bound updater descriptor", () => {
    expect(releaseWorkflow).toContain('npx tauri signer sign --app-version "$VERSION" "$deb"');
    expect(releaseWorkflow).toContain("platform: 'linux-x86_64-deb'");
    expect(releaseWorkflow).toContain("candidates/linux/updater-linux.json");
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
  it("uses the shared license destinations in stable and Preview Tauri bundles", () => {
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

describe("macOS Developer ID distribution", () => {
  it("imports revocable signing credentials into an ephemeral CI keychain", () => {
    for (const secret of [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_API_PRIVATE_KEY_BASE64",
      "APPLE_API_ISSUER",
      "APPLE_API_KEY",
    ]) {
      expect(releaseWorkflow).toContain(`secrets.${secret}`);
    }
    expect(macosSigningSetup).toContain("security create-keychain");
    expect(macosSigningSetup).toContain("security set-key-partition-list");
    expect(macosSigningSetup).toContain("APPLE_SIGNING_IDENTITY");
    expect(macosSigningSetup).toContain(
      "f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a"
    );
  });

  it("notarizes the final DMG before package smoke testing", () => {
    expect(releaseWorkflow).toContain("bash scripts/prepare-macos-signing.sh");
    expect(releaseWorkflow).toContain("bash scripts/notarize-macos-dmg.sh");
    expect(releaseWorkflow.indexOf("npm run desktop:stable-dmg")).toBeLessThan(
      releaseWorkflow.indexOf("bash scripts/notarize-macos-dmg.sh")
    );
    expect(releaseWorkflow.indexOf("bash scripts/notarize-macos-dmg.sh")).toBeLessThan(
      releaseWorkflow.indexOf("npm run desktop:verify-stable-dmg")
    );
    expect(macosDmgNotarization).toContain("xcrun notarytool submit");
    expect(macosDmgNotarization).toContain("xcrun stapler staple");
    expect(macosDmgNotarization).toContain("context:primary-signature");
  });

  it("verifies the notarized DMG, mounted app, and updater app", () => {
    expect(macosDmgSmoke).toContain('xcrun stapler validate "$dmg"');
    expect(macosDmgSmoke).toContain('xcrun stapler validate "$app"');
    expect(macosDmgSmoke).toContain('xcrun stapler validate "$updater_app"');
    expect(macosDmgSmoke).toContain('spctl --assess --type execute --verbose=4 "$updater_app"');
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

  it("requires three-platform capture acceptance before the draft", () => {
    expect(releaseWorkflow).toMatch(
      /\n {2}capture-acceptance:\n {4}needs: validate\n {4}uses: \.\/\.github\/workflows\/capture-acceptance\.yml\n {4}with:\n {6}commit_sha: \$\{\{ inputs\.commit_sha \}\}\n/
    );
    expect(prepareDraftNeeds).toEqual(DRAFT_GATES);
  });

  it("runs exact-SHA packaged update acceptance without operator file transfer", () => {
    expect(releaseWorkflow).toMatch(
      /\n {2}update-acceptance:\n {4}needs: validate\n {4}permissions:\n {6}actions: read\n {6}contents: read\n {4}uses: \.\/\.github\/workflows\/update-acceptance\.yml\n {4}with:\n {6}commit_sha: \$\{\{ inputs\.commit_sha \}\}\n/
    );
    expect(prepareDraftNeeds).toEqual(DRAFT_GATES);
    expect(updateAcceptanceWorkflow).toContain("npm run update:acceptance:run");
    expect(updateAcceptanceWorkflow).toContain("node scripts/export-update-acceptance.mjs");
    expect(updateAcceptanceWorkflow).toContain("actions/download-artifact@v8");
    expect(updateAcceptanceWorkflow).toContain(
      "node scripts/verify-update-acceptance.mjs update-evidence/windows"
    );
    expect(updateAcceptanceWorkflow).toContain(
      "node scripts/verify-update-acceptance.mjs update-evidence/macos"
    );
  });

  it("runs nightly update acceptance only for updater changes since the last success", () => {
    expect(updateAcceptanceWorkflow).toContain('\n  schedule:\n    - cron: "0 18 * * *"\n');
    expect(updateAcceptanceWorkflow).not.toContain("${{ inputs.commit_sha }}");
    expect(updateAcceptanceWorkflow).toContain(
      "actions/workflows/update-acceptance.yml/runs?status=success&per_page=1"
    );
    expect(updateAcceptanceWorkflow).toContain(
      "updateAcceptanceChangesSinceLastTag({ since: process.env.UPDATE_ACCEPTANCE_SINCE || undefined })"
    );
  });

  it("opens and meters the exact release candidates before the draft", () => {
    expect(releaseJobs["release-package-smoke"]).toEqual({
      needs: ["build-windows", "build-macos", "build-linux"],
      permissions: { actions: "read", contents: "read" },
      uses: "./.github/workflows/release-package-smoke.yml",
      with: { commit_sha: "${{ inputs.commit_sha }}" },
    });
    expect(prepareDraftNeeds).toEqual(DRAFT_GATES);
    const smoke = parse(releasePackageSmokeWorkflow);
    const job = smoke.jobs["package-smoke"];
    expect(job.strategy.matrix.include.map(({ platform }) => platform)).toEqual([
      "windows",
      "macos",
      "linux",
    ]);
    const steps = job.steps.map((step) => step.run ?? step.uses).join("\n");
    for (const platform of ["windows", "macos", "linux"]) {
      expect(releaseWorkflow).toContain(`name: release-candidate-${platform}`);
    }
    expect(steps).toContain("node scripts/release-package-smoke.mjs");
    expect(steps).toContain("node scripts/verify-release-package-evidence.mjs");
    expect(steps).toContain("--wait");
    expect(JSON.stringify(smoke)).not.toMatch(/continue-on-error|secrets/);
    expect(job.steps.filter((step) => step.if).map((step) => step.name)).toEqual([
      "Download the candidate from this release run",
      "Download the candidate from the named release run",
      "Upload release-package evidence",
    ]);
  });

  it("never lets capture acceptance be skipped or handed secrets", () => {
    const job = releaseWorkflow.split("\n  capture-acceptance:\n")[1].split(/\n {2}\S/)[0];
    expect(job).not.toMatch(/continue-on-error|^\s*if:|secrets/m);
  });

  it("builds stable releases on pinned hosted images", () => {
    expect(releaseWorkflow).not.toMatch(/runs-on:\s*(macos|windows)-latest/);
    expect(releaseWorkflow).toContain("runs-on: macos-26");
    expect(releaseWorkflow).toContain("runs-on: windows-2025-vs2026");
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
    expect(releaseWorkflow.match(/npm run desktop:stable-nsis/g)).toHaveLength(1);
    expect(releaseWorkflow.match(/npm run desktop:stable-dmg/g)).toHaveLength(1);
    expect(releaseWorkflow.match(/npm run desktop:stable-deb/g)).toHaveLength(1);
    expect(releaseWorkflow).toContain("release-candidate-windows");
    expect(releaseWorkflow).toContain("release-candidate-macos");
    expect(releaseWorkflow).toContain("release-candidate-linux");
    expect(releaseWorkflow).toContain("sudo bash scripts/verify-linux-deb-clean.sh");
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
  it("gates Linux publication on a tested Ubuntu package and complete platform asset set", () => {
    expect(previewBuildWorkflow).toContain("options: [windows, linux]");
    expect(previewBuildWorkflow).toContain("if: inputs.platform == 'linux'");
    expect(previewBuildWorkflow).toContain("if: inputs.platform == 'windows'");
    expect(previewBuildWorkflow).toContain("npm run desktop:preview-deb");
    expect(previewBuildWorkflow).toContain("npm run smoke:file-analysis");
    expect(previewBuildWorkflow).toContain("sudo bash scripts/verify-linux-deb-clean.sh");
    expect(previewBuildWorkflow).toContain(
      "needs: [validate, build-windows-preview, build-linux-preview]"
    );
    expect(previewBuildWorkflow).toContain("needs.build-linux-preview.result == 'success'");
    expect(previewBuildWorkflow).toContain("!cancelled() && needs.validate.result == 'success'");
    expect(previewBuildWorkflow).toContain("needs.prepare-draft.result == 'success'");
    expect(previewBuildWorkflow).toContain("preview-candidate-${{ inputs.platform }}");
    expect(previewBuildWorkflow).toContain('preview-assets "$PREVIEW_PLATFORM"');
    expect(previewBuildWorkflow).toContain(
      'if [[ "$PREVIEW_PLATFORM" == linux ]]; then expected_count=1; fi'
    );
  });
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
    expect(previewBuildWorkflow).toContain("npm run desktop:verify-preview-nsis");
    expect(previewBuildWorkflow).toContain("preview-${short_sha}-${GITHUB_RUN_ID}");
    expect(previewBuildSkill).toContain("--commit $sha --event workflow_dispatch");
  });

  it("installs the Linux system dependencies required by the repository gate", () => {
    expect(previewBuildWorkflow).toContain("Install Linux dependencies (Tauri / WebKit / audio)");
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
