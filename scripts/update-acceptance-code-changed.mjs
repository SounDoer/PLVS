/**
 * Require packaged update acceptance only when the installer/update chain changed.
 *
 * Two layers. `UPDATE_ACCEPTANCE_PATHS` is the product update chain: code that downloads,
 * coordinates, signs, packages, launches or installs an update. A release requires acceptance
 * only when it changed. `UPDATE_ACCEPTANCE_HARNESS_PATHS` is what drives the acceptance run
 * itself; changing it cannot change what users receive, so only the nightly run (and a standalone
 * dispatch) also watches it, and a broken harness still fails before release day.
 *
 * Version-only release files are deliberately absent. `lib.rs` is too: most releases touch it, so
 * its update wiring lives in `update_runtime.rs` and the test beside this file keeps lib.rs
 * calling into it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { STABLE_RELEASE_TAG_GLOB } from "./release-tag.mjs";

export const UPDATE_ACCEPTANCE_PATHS = [
  "src/hooks/AppLifecycleContext.jsx",
  "src/hooks/useUpdateController.js",
  "src/lib/updateController.js",
  "src-tauri/src/main.rs",
  "src-tauri/src/linux_update.rs",
  "src-tauri/src/update_cache.rs",
  "src-tauri/src/update_gate.rs",
  "src-tauri/src/update_runtime.rs",
  "src-tauri/src/update_worker.rs",
  "src-tauri/linux-update-installer",
  "src-tauri/Info.plist",
  "src-tauri/tauri.linux-deb.conf.json",
  "src-tauri/tauri.linux-stable-deb.conf.json",
  "src-tauri/tauri.macos.conf.json",
  "src-tauri/tauri.no-updater.conf.json",
  "src-tauri/tauri.windows.conf.json",
  "src-tauri/vendor/tauri-plugin-updater",
  "scripts/build-linux-deb.mjs",
  "scripts/build-updater-manifest.mjs",
  "scripts/notarize-macos-dmg.sh",
  "scripts/prepare-macos-signing.sh",
];
export const UPDATE_ACCEPTANCE_HARNESS_PATHS = [
  ".github/workflows/release.yml",
  ".github/workflows/update-acceptance.yml",
  "src/agentControl/developmentUpdateProtocol.js",
  "src/agentControl/handlers/developmentUpdate.js",
  "src/agentControl/handlers/index.js",
  "src/agentControl/AgentControlBridge.jsx",
  "src/agentControl/bridge/pipeline.js",
  "src/agentControl/useAgentControlBridge.js",
  "src-tauri/src/cli_control.rs",
  "scripts/build-update-acceptance.mjs",
  "scripts/export-update-acceptance.mjs",
  "scripts/probe-cached-updater.mjs",
  "scripts/release-package-smoke.mjs",
  "scripts/report-update-acceptance.mjs",
  "scripts/run-update-acceptance.mjs",
  "scripts/serve-update-acceptance.mjs",
  "scripts/update-acceptance-code-changed.mjs",
  "scripts/update-acceptance-evidence.mjs",
  "scripts/update-acceptance-lib.mjs",
  "scripts/update-acceptance-linux",
  "scripts/verify-macos-dmg.sh",
  "scripts/verify-update-acceptance.mjs",
];
export const UPDATE_ACCEPTANCE_CONTENT_PATHS = [
  "src-tauri/nsis/installer-hooks.nsh",
  "src-tauri/tauri.conf.json",
];

export function filterUpdateAcceptancePaths(paths, { includeHarness = false } = {}) {
  const guards = includeHarness
    ? [...UPDATE_ACCEPTANCE_PATHS, ...UPDATE_ACCEPTANCE_HARNESS_PATHS]
    : UPDATE_ACCEPTANCE_PATHS;
  return paths.filter((file) =>
    guards.some((guarded) => file === guarded || file.startsWith(`${guarded}/`))
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

/**
 * `since` replaces the last stable tag as the baseline, for the nightly run. `includeHarness` also
 * counts changes to the acceptance harness.
 */
export function updateAcceptanceChangesSinceLastTag({
  cwd = process.cwd(),
  since,
  includeHarness = false,
} = {}) {
  const git = (args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["rev-parse", "--verify", "HEAD"]);
  const tags = git(["tag", "--merged", "HEAD", "--list", STABLE_RELEASE_TAG_GLOB]);
  const tag =
    since ??
    (tags ? git(["describe", "--tags", "--match", STABLE_RELEASE_TAG_GLOB, "--abbrev=0"]) : null);
  const guardedPaths = [
    ...UPDATE_ACCEPTANCE_PATHS,
    ...UPDATE_ACCEPTANCE_HARNESS_PATHS,
    ...UPDATE_ACCEPTANCE_CONTENT_PATHS,
  ];
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
    paths: [...filterUpdateAcceptancePaths(changed, { includeHarness }), ...contentChanges],
  };
}
