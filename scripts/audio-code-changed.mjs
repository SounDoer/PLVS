/**
 * Did capture code or its release-smoke harness change since the last release?
 *
 * Pure git, no hardware. This is what keeps the release gate honest without
 * making VB-Cable's state a release dependency: the rig is only demanded when
 * capture-smoke dependencies actually changed, which for this project is a
 * small minority of releases.
 */
import { spawnSync } from "node:child_process";

export const CAPTURE_SMOKE_PATHS = [
  "src-tauri/src/audio",
  "src-tauri/src/dsp",
  "src-tauri/src/engine",
  "src-tauri/src/harness_main.rs",
  "src-tauri/src/cli_main.rs",
  "src-tauri/src/cli_capture.rs",
  "src-tauri/src/cli_analyze.rs",
  "src-tauri/src/cli_report.rs",
  "scripts/capture-rig.mjs",
  "scripts/smoke-capture.mjs",
];

export function filterCaptureSmokePaths(paths) {
  return paths.filter((path) =>
    CAPTURE_SMOKE_PATHS.some((guarded) => path === guarded || path.startsWith(`${guarded}/`)),
  );
}

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

/**
 * `null` last tag means no release history. Return the changed paths anyway:
 * an unknown comparison base is not evidence that nothing changed.
 */
export function lastTag() {
  return git(["describe", "--tags", "--abbrev=0"]);
}

export function captureSmokeChangesSinceLastTag() {
  const tag = lastTag();
  // Resolve the tag separately and pass it as a literal — PowerShell's $(...)
  // does not interpolate inside git arguments, a trap plvs-release already records.
  const range = tag ? `${tag}..HEAD` : null;
  const args = range
    ? ["diff", "--name-only", range, "--", ...CAPTURE_SMOKE_PATHS]
    : ["ls-files", "--", ...CAPTURE_SMOKE_PATHS];
  const out = git(args);
  if (out === null) {
    return { tag, paths: [] };
  }
  const paths = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return { tag, paths: filterCaptureSmokePaths(paths) };
}
