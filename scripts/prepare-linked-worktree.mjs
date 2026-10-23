#!/usr/bin/env node
// npm runs this after installing dependencies. A linked worktree starts without gitignored
// sidecars, so restore and verify them automatically instead of relying on an agent to remember.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { linkedWorktreeRoot } from "./dev-worktree.mjs";
import { main as ensureSidecars } from "./fetch-ffmpeg-sidecar.mjs";

export async function prepareLinkedWorktree({
  worktree = linkedWorktreeRoot(),
  ensure = ensureSidecars,
  log = console,
} = {}) {
  if (!worktree) {
    log.log("Primary checkout: linked-worktree sidecar preparation not needed.");
    return { prepared: false, worktree: null };
  }

  log.log(`Linked worktree detected: ${worktree}`);
  await ensure();
  log.log("Linked worktree sidecars are ready.");
  return { prepared: true, worktree };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareLinkedWorktree().catch((error) => {
    console.error(`Linked worktree preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
