#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const prettierPath =
  /^(?:src\/.*\.(?:js|jsx|css|json)|scripts\/.*\.(?:js|mjs|cjs|json)|\.github\/.*\.ya?ml|docs\/.*\.md|\.agents\/.*\.md|(?:AGENTS|CHANGELOG|CONTRIBUTING|README)\.md|package\.json)$/;

export function commandPlanForPaths(paths, { nodeExecutable = process.execPath } = {}) {
  const files = [...new Set(paths)];
  const commands = [];
  if (files.some((file) => prettierPath.test(file))) {
    commands.push({
      command: nodeExecutable,
      args: ["node_modules/lint-staged/bin/lint-staged.js"],
    });
  }
  if (files.some((file) => file.startsWith("src-tauri/") && file.endsWith(".rs"))) {
    commands.push({
      command: "cargo",
      args: ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--all", "--", "--check"],
    });
  }
  if (files.some((file) => /^src-tauri\/(?:[^/]+\/)*Cargo\.toml$/.test(file))) {
    commands.push({
      command: "cargo",
      quietStdout: true,
      args: [
        "metadata",
        "--locked",
        "--no-deps",
        "--format-version",
        "1",
        "--manifest-path",
        "src-tauri/Cargo.toml",
      ],
    });
  }
  return commands;
}

export function stagedPaths({ cwd = process.cwd() } = {}) {
  const bytes = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"],
    { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "inherit"] }
  );
  return bytes.toString("utf8").split("\0").filter(Boolean);
}

export function runPreCommit({ cwd = process.cwd(), paths = stagedPaths({ cwd }) } = {}) {
  const commands = commandPlanForPaths(paths);
  if (!commands.length) {
    console.log("Pre-commit: no staged formatter or Cargo contract applies.");
    return;
  }
  for (const { command, args, quietStdout = false } of commands) {
    const stdio = quietStdout ? ["ignore", "ignore", "inherit"] : "inherit";
    const result = spawnSync(command, args, { cwd, stdio, shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runPreCommit();
}
