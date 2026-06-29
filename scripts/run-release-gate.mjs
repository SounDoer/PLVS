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
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("Release state", "node", ["scripts/check-release-state.mjs"]);
run("Full repository check", npm, ["run", "check"]);

console.log("\nOK Local release preflight passed.");
