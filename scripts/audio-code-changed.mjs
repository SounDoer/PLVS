/**
 * Did the capture path change since the last release?
 *
 * Pure git, no hardware. This is what keeps the release gate honest without
 * making VB-Cable's state a release dependency: the rig is only demanded when
 * audio code actually changed, which for this project is a small minority of
 * releases.
 */
import { spawnSync } from "node:child_process";

export const AUDIO_PATHS = ["src-tauri/src/audio", "src-tauri/src/dsp", "src-tauri/src/engine"];

export function filterAudioPaths(paths) {
  return paths.filter((p) => AUDIO_PATHS.some((dir) => p.startsWith(`${dir}/`)));
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

export function audioChangesSinceLastTag() {
  const tag = lastTag();
  // Resolve the tag separately and pass it as a literal — PowerShell's $(...)
  // does not interpolate inside git arguments, a trap plvs-release already records.
  const range = tag ? `${tag}..HEAD` : null;
  const args = range
    ? ["diff", "--name-only", range, "--", ...AUDIO_PATHS]
    : ["ls-files", "--", ...AUDIO_PATHS];
  const out = git(args);
  if (out === null) {
    return { tag, paths: [] };
  }
  const paths = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return { tag, paths: filterAudioPaths(paths) };
}
