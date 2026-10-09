#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlvsCli } from "./build-plvs-cli.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

try {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("Build the Linux Preview package on Ubuntu 24.04 x86_64.");
  }
  const os = readFileSync("/etc/os-release", "utf8");
  if (!/^ID=ubuntu$/m.test(os) || !/^VERSION_ID="24\.04"$/m.test(os)) {
    throw new Error(
      "Ubuntu 24.04 is the package's build baseline; newer hosts can raise its ABI requirements."
    );
  }
  if (process.argv.length > 2)
    throw new Error("This Preview builder accepts no extra build flags.");
  buildPlvsCli({ profile: "release", identity: "preview", stage: true });
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
      "build",
      "--bundles",
      "deb",
      // Reset the base resource map before Preview replaces it. Recursive map merging otherwise
      // sends both stable and Preview manifests to the same installed plvs-agent.json path.
      "--config",
      "src-tauri/tauri.clear-resources.conf.json",
      "--config",
      "src-tauri/tauri.preview.conf.json",
      "--config",
      "src-tauri/tauri.linux-deb.conf.json",
      "--features",
      "preview-identity",
    ],
    { cwd: root, stdio: "inherit" }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
