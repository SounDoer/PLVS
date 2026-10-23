#!/usr/bin/env node
/**
 * Complete local pre-dispatch release gate.
 *
 * The fast release-state script checks version/changelog/git/tag state. This
 * wrapper then runs the full repository check so the release command has one
 * memorable entrypoint.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { updateAcceptanceChangesSinceLastTag } from "./update-acceptance-code-changed.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(label, command, args) {
  console.log(`\n== ${label} ==`);
  // shell:true is required on Windows + Node >= 20.12/22: spawning a .cmd shim
  // (npm.cmd) without it now fails with EINVAL (CVE-2024-27980 hardening).
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell: true });
  if (result.error) {
    console.error(`Failed to run "${label}": ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("Release state", "node", ["scripts/check-release-state.mjs"]);
run("Public content review", "node", ["scripts/release-content-review.mjs", "check"]);
run("Fork pull request approval", "node", ["scripts/check-fork-pr-approval.mjs"]);
run("Full repository check", npm, ["run", "check"]);
run("Corresponding-source availability", npm, ["run", "licenses:sources"]);
const updateAcceptanceChanges = updateAcceptanceChangesSinceLastTag({ cwd: root });
if (updateAcceptanceChanges.paths.length > 0) {
  console.log(
    `\n== Update acceptance dependencies ==\nChanged since ${
      updateAcceptanceChanges.tag ?? "the initial commit"
    }:`
  );
  for (const path of updateAcceptanceChanges.paths) console.log(`  ${path}`);
  console.log(
    "Exact-SHA Windows, macOS and Linux update acceptance will run automatically on the self-hosted runners before the Release draft is assembled."
  );
  run("Local update acceptance evidence (advisory)", "node", [
    "scripts/report-update-acceptance.mjs",
  ]);
} else {
  run("Update acceptance evidence (advisory)", "node", ["scripts/report-update-acceptance.mjs"]);
}

// Real capture smoke and the release-package Agent Control smoke run remotely for the exact
// release commit and packages on all three self-hosted runners (capture-acceptance.yml and
// release-package-smoke.yml, called by release.yml), so this local gate drives neither the rig
// nor a desktop app.

console.log("\nOK Local release preflight passed.");
