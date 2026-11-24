#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const prettierPath =
  /^(?:src\/.*\.(?:js|jsx|css|json)|scripts\/.*\.(?:js|mjs|cjs|json)|\.github\/.*\.ya?ml|docs\/.*\.md|\.agents\/.*\.md|(?:AGENTS|CHANGELOG|CONTRIBUTING|README)\.md|package\.json)$/;
const cargoDependencyPath = /^src-tauri\/(?:(?:[^/]+\/)*Cargo\.toml|Cargo\.lock)$/;

export function commandPlanForPaths(paths, { nodeExecutable = process.execPath } = {}) {
  const files = [...new Set(paths)];
  const commands = [];
  if (files.some((file) => prettierPath.test(file))) {
    commands.push({
      command: nodeExecutable,
      args: ["node_modules/lint-staged/bin/lint-staged.js", "--hide-unstaged"],
    });
  }
  if (files.some((file) => file.startsWith("src-tauri/") && file.endsWith(".rs"))) {
    commands.push({
      command: "cargo",
      args: ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--all", "--", "--check"],
    });
  }
  if (files.some((file) => cargoDependencyPath.test(file))) {
    // Cargo must resolve dependencies to check the lockfile. --no-deps skips that check.
    commands.push({
      command: "cargo",
      fromCargoIndex: true,
      args: [
        "metadata",
        "--locked",
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
    ["diff", "--cached", "--name-status", "--no-renames", "--diff-filter=AMDT", "-z"],
    { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "inherit"] }
  );
  const fields = bytes.toString("utf8").split("\0");
  const paths = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const [status, file] = [fields[i], fields[i + 1]];
    if (status !== "D" || cargoDependencyPath.test(file)) paths.push(file);
  }
  return paths;
}

function runCargoIndexCheck(command, args, cwd) {
  const snapshot = mkdtempSync(join(tmpdir(), "plvs-cargo-index-"));
  try {
    // Cargo reads files on disk. Materialize the Git index outside the checkout so
    // partially staged changes are checked as committed, with local crate paths intact.
    const paths = execFileSync(
      "git",
      ["ls-files", "--cached", "-z", "--", "src-tauri", ".cargo", "rust-toolchain.toml"],
      { cwd }
    );
    execFileSync(
      "git",
      ["checkout-index", "--ignore-skip-worktree-bits", "--stdin", "-z", `--prefix=${snapshot}/`],
      { cwd, input: paths, stdio: ["pipe", "ignore", "inherit"] }
    );
    return spawnSync(command, args, { cwd: snapshot, stdio: ["ignore", "ignore", "inherit"] });
  } finally {
    rmSync(snapshot, { recursive: true, force: true });
  }
}

export function runPreCommit({ cwd = process.cwd(), paths = stagedPaths({ cwd }) } = {}) {
  const commands = commandPlanForPaths(paths);
  if (!commands.length) {
    console.log("Pre-commit: no staged formatter or Cargo contract applies.");
    return;
  }
  for (const { command, args, fromCargoIndex } of commands) {
    const result = fromCargoIndex
      ? runCargoIndexCheck(command, args, cwd)
      : spawnSync(command, args, { cwd, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      if (fromCargoIndex) {
        console.error(
          "Cargo lock check failed for the Git index. Stage any Cargo.lock updates before retrying."
        );
      }
      process.exit(result.status ?? 1);
    }
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runPreCommit();
}
