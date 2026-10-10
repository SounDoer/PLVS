import { execFileSync } from "node:child_process";
import { STABLE_RELEASE_TAG_GLOB } from "./audio-code-changed.mjs";

// Domain owners and renderers are part of the real desktop control path too.
export const AGENT_CONTROL_SMOKE_PATHS = [
  "src",
  "src-tauri",
  "shared",
  "package.json",
  "package-lock.json",
  "vite.config.js",
  "scripts/smoke-agent-control.mjs",
  "scripts/build-plvs-cli.mjs",
  "scripts/agent-control-code-changed.mjs",
  "scripts/run-release-gate.mjs",
  "scripts/ui-visual-walkthrough-lib.mjs",
];

export function agentControlSmokeChangesSinceLastTag({ cwd = process.cwd() } = {}) {
  const git = (args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  // An invalid repository or a failed comparison must never silently waive the gate.
  git(["rev-parse", "--verify", "HEAD"]);
  const tags = git(["tag", "--merged", "HEAD", "--list", STABLE_RELEASE_TAG_GLOB]);
  const tag = tags
    ? git(["describe", "--tags", "--match", STABLE_RELEASE_TAG_GLOB, "--abbrev=0"])
    : null;
  const committed = git(
    tag
      ? ["diff", "--name-only", `${tag}..HEAD`, "--", ...AGENT_CONTROL_SMOKE_PATHS]
      : ["ls-files", "--", ...AGENT_CONTROL_SMOKE_PATHS]
  );
  const working = git(["diff", "--name-only", "HEAD", "--", ...AGENT_CONTROL_SMOKE_PATHS]);
  const untracked = git([
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...AGENT_CONTROL_SMOKE_PATHS,
  ]);
  return {
    tag,
    paths: [
      ...new Set(
        [committed, working, untracked].flatMap((value) => value.split(/\r?\n/).filter(Boolean))
      ),
    ],
  };
}
