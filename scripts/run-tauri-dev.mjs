#!/usr/bin/env node
/**
 * Runs `tauri dev` with the dev-identity target directory (ADR 0024).
 *
 * The directory is passed as CARGO_TARGET_DIR because Tauri has to find the binary it launches
 * as well as build it, and an npm script cannot set an environment variable portably.
 *
 * In a linked worktree the dev app also gets its own Vite port and app-data root (ADR 0028), so
 * it can run beside the dev apps of the main checkout and of other worktrees.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEV_IDENTITY_TARGET_DIRECTORY } from "./build-plvs-cli.mjs";
import {
  chooseWorktreePort,
  linkedWorktreeRoot,
  readBaseTauriConfig,
  worktreeDataRoot,
  worktreeTauriConfig,
  worktreeTauriDevArgs,
} from "./dev-worktree.mjs";

let args = process.argv.slice(2);
const env = { ...process.env, CARGO_TARGET_DIR: DEV_IDENTITY_TARGET_DIRECTORY };

const worktree = linkedWorktreeRoot();
if (worktree) {
  const port = await chooseWorktreePort(worktree);
  const configPath = join(DEV_IDENTITY_TARGET_DIRECTORY, "worktree-dev.conf.json");
  mkdirSync(DEV_IDENTITY_TARGET_DIRECTORY, { recursive: true });
  writeFileSync(configPath, JSON.stringify(worktreeTauriConfig(readBaseTauriConfig(), port)));
  const dataRoot = worktreeDataRoot(worktree);
  args = worktreeTauriDevArgs(args, { configPath, dataRoot });
  // `beforeDevCommand` inherits this, and vite.config.js binds it.
  env.PLVS_DEV_PORT = String(port);
  console.log(`Linked worktree: dev server on port ${port}, app data in ${dataRoot}`);
}

// shell:true is required on Windows to launch the tauri.cmd shim. The shell joins arguments
// unquoted, and the worktree paths added above may contain spaces.
const quoted = args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg));
const result = spawnSync("tauri", ["dev", ...quoted], {
  stdio: "inherit",
  shell: true,
  env,
});
if (result.error) {
  console.error(`Unable to run tauri dev: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 2);
