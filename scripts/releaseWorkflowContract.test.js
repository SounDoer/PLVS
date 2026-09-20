import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

const releaseWorkflow = readFileSync(join(cwd(), ".github", "workflows", "release.yml"), "utf8");
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

  it("publishes a verified immutable Draft instead of overwriting a rolling release", () => {
    expect(previewBuildWorkflow).toContain("node scripts/validate-preview-bundle.mjs");
    expect(previewBuildWorkflow).toContain("--draft");
    expect(previewBuildWorkflow).toContain("--prerelease");
    expect(previewBuildWorkflow).toContain("--draft=false --prerelease --latest=false");
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
