#!/usr/bin/env node
/**
 * Complete local pre-tag release gate.
 *
 * The fast release-state script checks version/changelog/git/tag state. This
 * wrapper then runs the full repository check so the release command has one
 * memorable entrypoint.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
run("Full repository check", npm, ["run", "check"]);

console.log("\nOK Local release preflight passed.");
