#!/usr/bin/env node
import { chmodSync, copyFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlvsCli } from "./build-plvs-cli.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  const identity = process.argv[2];
  if (!new Set(["stable", "preview"]).has(identity)) {
    throw new Error("Usage: build-linux-deb.mjs stable|preview");
  }
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Build the Linux package on Ubuntu 24.04 x86_64.");
  }
  const os = readFileSync("/etc/os-release", "utf8");
  if (!/^ID=ubuntu$/m.test(os) || !/^VERSION_ID="24\.04"$/m.test(os)) {
    throw new Error(
      "Ubuntu 24.04 is the package's build baseline; newer hosts can raise its ABI requirements."
    );
  }
  if (process.argv.length !== 3) throw new Error("This Linux builder accepts one identity.");
  if (identity === "stable") {
    const installer = spawnSync(
      "cargo",
      ["build", "--release", "--package", "plvs-update-installer"],
      { cwd: join(root, "src-tauri"), stdio: "inherit" }
    );
    if (installer.error) throw installer.error;
    if (installer.status !== 0) process.exit(installer.status ?? 1);
    const staged = join(root, "src-tauri", "binaries", "plvs-update-installer");
    copyFileSync(join(root, "src-tauri", "target", "release", "plvs-update-installer"), staged);
    chmodSync(staged, 0o755);
  }
  buildPlvsCli({ profile: "release", identity, stage: true });
  const config = [
    ...(identity === "preview"
      ? [
          "--config",
          "src-tauri/tauri.clear-resources.conf.json",
          "--config",
          "src-tauri/tauri.preview.conf.json",
        ]
      : []),
    "--config",
    "src-tauri/tauri.linux-deb.conf.json",
    "--config",
    `src-tauri/tauri.linux-${identity}-deb.conf.json`,
  ];
  const features = identity === "preview" ? ["--features", "preview-identity"] : [];
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
      "build",
      "--bundles",
      "deb",
      // Preview deletes the inherited stable manifest before installing its own. Keep the reset
      // ahead of the Preview overlay because Tauri merges all CLI patches before the base config.
      ...config,
      ...features,
    ],
    { cwd: root, stdio: "inherit" }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
