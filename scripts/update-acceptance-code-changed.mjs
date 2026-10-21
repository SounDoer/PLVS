/**
 * Require packaged update acceptance only when the installer/update chain changed.
 *
 * Version-only release files are deliberately absent: this is the narrower rollout gate, not an
 * every-release requirement. The guarded set covers code that downloads, coordinates, signs,
 * packages, launches, or validates an installed update, plus the acceptance gate itself.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { STABLE_RELEASE_TAG_GLOB } from "./audio-code-changed.mjs";

export const UPDATE_ACCEPTANCE_PATHS = [
  ".github/workflows/release.yml",
  ".github/workflows/upgrade-candidate.yml",
  ".github/workflows/update-acceptance.yml",
  "src/agentControl/developmentUpdateProtocol.js",
  "src/agentControl/handlers/developmentUpdate.js",
  "src/agentControl/handlers/index.js",
  "src/agentControl/AgentControlBridge.jsx",
  "src/agentControl/bridge/pipeline.js",
  "src/agentControl/useAgentControlBridge.js",
  "src/hooks/AppLifecycleContext.jsx",
  "src/hooks/useUpdateController.js",
  "src/lib/updateController.js",
  "src-tauri/src/lib.rs",
  "src-tauri/src/cli_control.rs",
  "src-tauri/src/linux_update.rs",
  "src-tauri/src/update_cache.rs",
  "src-tauri/src/update_gate.rs",
  "src-tauri/src/update_runtime.rs",
  "src-tauri/src/update_worker.rs",
  "src-tauri/linux-update-installer",
  "src-tauri/Info.plist",
  "src-tauri/tauri.linux-stable-deb.conf.json",
  "src-tauri/tauri.macos.conf.json",
  "src-tauri/tauri.no-updater.conf.json",
  "src-tauri/tauri.windows.conf.json",
  "src-tauri/vendor/tauri-plugin-updater",
  "scripts/build-linux-deb.mjs",
  "scripts/build-update-acceptance.mjs",
  "scripts/build-upgrade-test-manifest.mjs",
  "scripts/build-updater-manifest.mjs",
  "scripts/export-update-acceptance.mjs",
  "scripts/notarize-macos-dmg.sh",
  "scripts/prepare-macos-signing.sh",
  "scripts/probe-cached-updater.mjs",
  "scripts/report-update-acceptance.mjs",
  "scripts/run-release-gate.mjs",
  "scripts/run-update-acceptance.mjs",
  "scripts/serve-update-acceptance.mjs",
  "scripts/update-acceptance-code-changed.mjs",
  "scripts/update-acceptance-evidence.mjs",
  "scripts/update-acceptance-lib.mjs",
  "scripts/verify-macos-dmg.sh",
  "scripts/verify-update-acceptance.mjs",
];
export const UPDATE_ACCEPTANCE_CONTENT_PATHS = [
  "src-tauri/nsis/installer-hooks.nsh",
  "src-tauri/tauri.conf.json",
];

export function filterUpdateAcceptancePaths(paths) {
  return paths.filter((file) =>
    UPDATE_ACCEPTANCE_PATHS.some((guarded) => file === guarded || file.startsWith(`${guarded}/`))
  );
}

export function normalizeUpdateAcceptanceContent(file, contents) {
  if (file === "src-tauri/nsis/installer-hooks.nsh") {
    return contents.replace(/^!define PLVS_AGENT_VERSION ".*"\r?\n/m, "").trim();
  }
  if (file === "src-tauri/tauri.conf.json") {
    const config = JSON.parse(contents);
    return JSON.stringify({
      identifier: config.identifier,
      updater: config.plugins?.updater,
      bundle: {
        active: config.bundle?.active,
        createUpdaterArtifacts: config.bundle?.createUpdaterArtifacts,
        targets: config.bundle?.targets,
        macOS: config.bundle?.macOS,
        windows: config.bundle?.windows,
      },
    });
  }
  return contents;
}

export function updateAcceptanceChangesSinceLastTag({ cwd = process.cwd() } = {}) {
  const git = (args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["rev-parse", "--verify", "HEAD"]);
  const tags = git(["tag", "--merged", "HEAD", "--list", STABLE_RELEASE_TAG_GLOB]);
  const tag = tags
    ? git(["describe", "--tags", "--match", STABLE_RELEASE_TAG_GLOB, "--abbrev=0"])
    : null;
  const guardedPaths = [...UPDATE_ACCEPTANCE_PATHS, ...UPDATE_ACCEPTANCE_CONTENT_PATHS];
  const committed = git(
    tag
      ? ["diff", "--name-only", `${tag}..HEAD`, "--", ...guardedPaths]
      : ["ls-files", "--", ...guardedPaths]
  );
  const working = git(["diff", "--name-only", "HEAD", "--", ...guardedPaths]);
  const untracked = git(["ls-files", "--others", "--exclude-standard", "--", ...guardedPaths]);
  const changed = [
    ...new Set([committed, working, untracked].flatMap((value) => value.split(/\r?\n/))),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
  const contentChanges = UPDATE_ACCEPTANCE_CONTENT_PATHS.filter((file) => {
    if (!changed.includes(file)) return false;
    if (!existsSync(path.join(cwd, file))) return true;
    const current = normalizeUpdateAcceptanceContent(
      file,
      readFileSync(path.join(cwd, file), "utf8")
    );
    if (!tag) return true;
    let baseline;
    try {
      baseline = normalizeUpdateAcceptanceContent(file, git(["show", `${tag}:${file}`]));
    } catch {
      return true;
    }
    return current !== baseline;
  });
  return {
    tag,
    paths: [...filterUpdateAcceptancePaths(changed), ...contentChanges],
  };
}
