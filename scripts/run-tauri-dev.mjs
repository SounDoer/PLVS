#!/usr/bin/env node
/**
 * Runs `tauri dev` with the dev-identity target directory (ADR 0024).
 *
 * The directory is passed as CARGO_TARGET_DIR because Tauri has to find the binary it launches
 * as well as build it, and an npm script cannot set an environment variable portably.
 */
import { spawnSync } from "node:child_process";
import { DEV_IDENTITY_TARGET_DIRECTORY } from "./build-plvs-cli.mjs";

// shell:true is required on Windows to launch the tauri.cmd shim.
const result = spawnSync("tauri", ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, CARGO_TARGET_DIR: DEV_IDENTITY_TARGET_DIRECTORY },
});
if (result.error) {
  console.error(`Unable to run tauri dev: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status ?? 2);
