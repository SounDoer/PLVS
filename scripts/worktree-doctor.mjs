#!/usr/bin/env node
// Verifies the common software state every PLVS worktree needs. Task-specific tools such as
// Playwright, VLC and virtual audio devices remain the responsibility of their own preflights.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { linkedWorktreeRoot } from "./dev-worktree.mjs";
import { main as ensureSidecars } from "./fetch-ffmpeg-sidecar.mjs";

export function commandVersion(command, args = ["--version"], run = spawnSync, cwd) {
  const result = run(command, args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
    throw new Error(`${command} is unavailable: ${detail}`);
  }
  return result.stdout.trim();
}

export async function inspectWorktree({
  root = join(import.meta.dirname, ".."),
  worktree = linkedWorktreeRoot(root),
  run = spawnSync,
  ensure = ensureSidecars,
  log = console,
} = {}) {
  const expectedNode = readFileSync(join(root, ".nvmrc"), "utf8").trim();
  const expectedRust = readFileSync(join(root, "rust-toolchain.toml"), "utf8").match(
    /^channel\s*=\s*"([^"]+)"/m
  )?.[1];
  if (!expectedRust) throw new Error("rust-toolchain.toml has no toolchain channel.");
  const actualNode = process.version.replace(/^v/, "");
  if (actualNode !== expectedNode) {
    throw new Error(`Node ${expectedNode} is required by .nvmrc; current Node is ${actualNode}.`);
  }
  if (!existsSync(join(root, "node_modules", ".package-lock.json"))) {
    throw new Error("Dependencies are not installed from package-lock.json; run npm ci.");
  }

  await ensure();
  const cargo = commandVersion("cargo", ["--version"], run, root);
  const rustc = commandVersion("rustc", ["--version"], run, root);
  if (!rustc.startsWith(`rustc ${expectedRust} `)) {
    throw new Error(`Rust ${expectedRust} is required by rust-toolchain.toml; current ${rustc}.`);
  }
  const kind = worktree ? "linked worktree" : "primary checkout";
  log.log(`Worktree ready (${kind}, Node ${actualNode}, ${cargo}, ${rustc}).`);
  return { kind, node: actualNode, cargo, rustc };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  inspectWorktree().catch((error) => {
    console.error(`Worktree doctor failed: ${error.message}`);
    process.exitCode = 1;
  });
}
