#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./generate-component-notices.mjs";
import { collectRustRuntimePackages } from "./generate-license-inventory.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function generateNativeNotices() {
  for (const variable of [
    "ORT_LIB_PATH",
    "ORT_LIB_LOCATION",
    "ORT_PREFER_DYNAMIC_LINK",
    "ORT_SKIP_DOWNLOAD",
    "ORT_OFFLINE",
  ]) {
    if (process.env[variable]) throw new Error(`Unreviewed ONNX Runtime override: ${variable}`);
  }
  const policy = JSON.parse(await readFile(join(root, "licenses/native-components.json"), "utf8"));
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  for (const [name, version] of Object.entries(policy.npmVersions || {})) {
    if (lock.packages[`node_modules/${name}`]?.version !== version) {
      throw new Error(`Native toolchain package changed; review installer components: ${name}`);
    }
  }
  const rustVersion = spawnSync("rustc", ["--version"], { encoding: "utf8" });
  if (rustVersion.status !== 0 || !rustVersion.stdout.startsWith(`rustc ${policy.rustVersion} `)) {
    throw new Error("Rust toolchain changed; refresh and review the standard-library notices");
  }
  const sysroot = spawnSync("rustc", ["--print", "sysroot"], { encoding: "utf8" });
  if (sysroot.status !== 0) throw new Error("Cannot locate Rust standard-library notices");
  const rustAssets = JSON.parse(await readFile(join(root, "licenses/rust-materials.json"), "utf8"));
  for (const asset of rustAssets) {
    const installed = join(
      sysroot.stdout.trim(),
      "share/doc/rust",
      asset.source.slice("licenses/rust/".length)
    );
    if (
      digest(await readFile(installed)) !== asset.sha256 ||
      digest(await readFile(join(root, asset.source))) !== asset.sha256
    ) {
      throw new Error(`Rust standard-library notice changed: ${asset.source}`);
    }
  }
  const cargo = spawnSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked", "--manifest-path", "src-tauri/Cargo.toml"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (cargo.status !== 0) throw new Error(cargo.stderr || "cargo metadata failed");
  const metadata = JSON.parse(cargo.stdout);
  const packages = new Map(metadata.packages.map((p) => [`${p.name}@${p.version}`, p]));
  for (const pkg of collectRustRuntimePackages(metadata).filter((p) => p.links)) {
    if (!policy.bindings[`${pkg.name}@${pkg.version}`])
      throw new Error(`Unreviewed native binding: ${pkg.name}@${pkg.version}`);
  }
  for (const input of policy.inputs) {
    const directory = input.package
      ? dirname(packages.get(input.package)?.manifest_path || "")
      : root;
    if (input.package && !packages.has(input.package))
      throw new Error(`Native dependency changed: ${input.package}`);
    if (digest(await readFile(join(directory, input.path))) !== input.sha256)
      throw new Error(
        `Native license review required: ${input.package || "repository"}/${input.path}`
      );
  }
  const blocks = ["PLVS NATIVE COMPONENTS AND MODEL NOTICES", "", ...policy.notes, ""];
  for (const doc of policy.documents) {
    const bytes = await readFile(join(root, doc.file));
    if (digest(bytes) !== doc.sha256) throw new Error(`Changed native notice: ${doc.file}`);
    blocks.push(
      "=".repeat(72),
      doc.name,
      `License: ${doc.license}`,
      `Original notice: ${doc.url}`,
      "",
      bytes.toString("utf8").replace(/\r\n/g, "\n"),
      ""
    );
  }
  for (const source of policy.sources)
    blocks.push(
      `Corresponding source: ${source.name}`,
      source.url,
      `SHA-256: ${source.sha256}`,
      ""
    );
  return blocks.join("\n");
}

export async function verifyPublishedSources() {
  const policy = JSON.parse(await readFile(join(root, "licenses/native-components.json"), "utf8"));
  for (const source of policy.sources) {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok)
      throw new Error(`Source download unavailable (${response.status}): ${source.url}`);
    if (digest(Buffer.from(await response.arrayBuffer())) !== source.sha256)
      throw new Error(`Published source checksum mismatch: ${source.url}`);
  }
  console.log("Published corresponding-source downloads verified");
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--sources") return verifyPublishedSources();
  if (!["--write", "--check"].includes(mode))
    throw new Error("Usage: generate-native-notices.mjs --write|--check|--sources");
  const generated = await generateNativeNotices();
  const path = join(root, "licenses/NATIVE-NOTICES.txt");
  if (mode === "--write") await writeFile(path, generated);
  else if ((await readFile(path, "utf8")).replace(/\r\n/g, "\n") !== generated)
    throw new Error("Native notices are stale; run npm run licenses:generate");
  console.log("Native component license materials verified");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
