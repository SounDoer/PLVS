#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "src-tauri", "plvs-cli", "Cargo.toml");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw new Error(`Unable to run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`${command} exited with status ${result.status ?? 2}`);
  }
  return result;
}

export function parseRustHostTriple(versionOutput) {
  const match = versionOutput.match(/^host:\s*(\S+)$/m);
  if (!match) throw new Error("Unable to determine the Rust host target triple.");
  return match[1];
}

export function cliArtifactPaths({ targetDirectory, profile, targetTriple, crossTarget = false }) {
  const extension = targetTriple.includes("windows") ? ".exe" : "";
  const outputDirectory = crossTarget
    ? join(targetDirectory, targetTriple, profile)
    : join(targetDirectory, profile);
  return {
    executable: join(outputDirectory, `plvs-cli${extension}`),
    staged: join(root, "src-tauri", "binaries", `plvs-cli-${targetTriple}${extension}`),
  };
}

export function buildPlvsCli({
  profile = "debug",
  identity = "release",
  stage = false,
  target,
} = {}) {
  if (!new Set(["debug", "release"]).has(profile)) {
    throw new Error(`Unsupported CLI profile: ${profile}`);
  }
  if (!new Set(["release", "development"]).has(identity)) {
    throw new Error(`Unsupported CLI identity: ${identity}`);
  }

  const buildArgs = ["build", "--quiet", "--manifest-path", manifestPath];
  if (profile === "release") buildArgs.push("--release");
  if (identity === "development") buildArgs.push("--features", "dev-identity");
  if (target) buildArgs.push("--target", target);
  run("cargo", buildArgs);

  const metadata = run(
    "cargo",
    ["metadata", "--quiet", "--manifest-path", manifestPath, "--no-deps", "--format-version", "1"],
    { capture: true }
  );
  let targetDirectory;
  try {
    targetDirectory = JSON.parse(metadata.stdout).target_directory;
  } catch (error) {
    throw new Error(`Unable to read Cargo metadata: ${error.message}`);
  }

  const targetTriple =
    target ?? parseRustHostTriple(run("rustc", ["-vV"], { capture: true }).stdout);
  const paths = cliArtifactPaths({
    targetDirectory,
    profile,
    targetTriple,
    crossTarget: Boolean(target),
  });

  if (stage) {
    mkdirSync(dirname(paths.staged), { recursive: true });
    copyFileSync(paths.executable, paths.staged);
    if (!targetTriple.includes("windows")) chmodSync(paths.staged, 0o755);
  }

  return { ...paths, targetTriple };
}

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--stage") {
      options.stage = true;
    } else if (argument === "--profile") {
      options.profile = args[(index += 1)];
    } else if (argument === "--identity") {
      options.identity = args[(index += 1)];
    } else if (argument === "--target") {
      options.target = args[(index += 1)];
    } else {
      throw new Error(`Unknown CLI build option: ${argument}`);
    }
  }
  return options;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = buildPlvsCli(options);
    if (options.stage) console.log(`Staged ${result.staged}`);
  } catch (error) {
    console.error(`PLVS CLI build failed: ${error.message}`);
    process.exit(2);
  }
}
