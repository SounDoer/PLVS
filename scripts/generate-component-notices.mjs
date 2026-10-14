#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectRustRuntimePackages,
  collectJavascriptProductionPackages,
} from "./generate-license-inventory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalize = (text) => text.replace(/\r\n/g, "\n");
const licenseName =
  /^(licen[cs]e|copying|notice|copyright|unlicense|third[-_]?party[-_]?notices)([._-]|$)/i;

// Preserve nested notices too (e.g. ring's BoringSSL and fiat code). Do not follow symlinks.
export async function collectNoticeFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !["node_modules", ".git", "target"].includes(entry.name)) {
      files.push(...(await collectNoticeFiles(directory, relative)));
    } else if (entry.isFile() && licenseName.test(entry.name)) {
      files.push(relative);
    }
  }
  return files.sort();
}

export function assertReviewed(component, review) {
  if (!review || component.license === "UNKNOWN" || review.license !== component.license) {
    throw new Error(
      `Unreviewed component or changed license: ${component.id} (${component.license})`
    );
  }
}

export function assertInstalledPackageVersion(expected, installed) {
  if (installed.name !== expected.name || installed.version !== expected.version) {
    throw new Error(
      `Installed package does not match lockfile: ${expected.name}@${expected.version}; ` +
        `found ${installed.name}@${installed.version}. Run npm ci before reviewing notices.`
    );
  }
}

export function assertNoRestrictedComponent(id, restrictions) {
  for (const [name, reason] of Object.entries(restrictions || {})) {
    if (id.startsWith(`${name}@`)) throw new Error(`Restricted component ${id}: ${reason}`);
  }
}

export async function generateComponentNotices({ candidate = false } = {}) {
  const cargo = spawnSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked", "--manifest-path", "src-tauri/Cargo.toml"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (cargo.status !== 0) throw new Error(cargo.stderr || "cargo metadata failed");
  const metadata = JSON.parse(cargo.stdout);
  const lock = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
  const policy = JSON.parse(await readFile(join(root, "licenses/component-sources.json"), "utf8"));
  const runtimeIds = new Set(collectRustRuntimePackages(metadata).map((p) => p.id));
  const tools = {};
  for (const pkg of metadata.packages.filter(
    (p) => !runtimeIds.has(p.id) && !metadata.workspace_members.includes(p.id)
  )) {
    tools[`rust:${pkg.name}@${pkg.version}`] = pkg.license || "UNKNOWN";
  }
  for (const [path, pkg] of Object.entries(lock.packages)) {
    if (path && pkg.dev === true)
      tools[`npm:${path.slice(path.lastIndexOf("node_modules/") + 13)}@${pkg.version}`] =
        pkg.license || "UNKNOWN";
  }
  const sortedTools = Object.fromEntries(
    Object.entries(tools).sort(([a], [b]) => a.localeCompare(b, "en"))
  );
  if (
    !candidate &&
    (Object.values(tools).includes("UNKNOWN") ||
      JSON.stringify(policy.tools) !== JSON.stringify(sortedTools))
  ) {
    throw new Error(
      "Development/build tool versions or licenses changed; review the candidate tools inventory"
    );
  }
  const components = collectRustRuntimePackages(metadata)
    .filter((pkg) => pkg.name !== "plvs")
    .map((pkg) => ({
      id: `rust:${pkg.name}@${pkg.version}`,
      license:
        pkg.license ||
        (pkg.license_file && pkg.name === "voice_activity_detector" ? "MIT" : "UNKNOWN"),
      directory: dirname(pkg.manifest_path),
      source: pkg.source?.startsWith("registry+")
        ? `https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download`
        : "https://github.com/SounDoer/PLVS/tree/main/src-tauri/vendor/voice_activity_detector",
    }));
  for (const pkg of collectJavascriptProductionPackages(lock)) {
    assertInstalledPackageVersion(
      pkg,
      JSON.parse(await readFile(join(root, pkg.path, "package.json"), "utf8"))
    );
    components.push({
      id: `npm:${pkg.name}@${pkg.version}`,
      license: pkg.license,
      directory: join(root, pkg.path),
      source: lock.packages[pkg.path].resolved,
    });
  }
  // Tailwind generates CSS shipped in the application despite being a devDependency.
  for (const name of ["tailwindcss"]) {
    const pkg = lock.packages[`node_modules/${name}`];
    assertInstalledPackageVersion(
      { name, version: pkg.version },
      JSON.parse(await readFile(join(root, "node_modules", name, "package.json"), "utf8"))
    );
    components.push({
      id: `npm:${name}@${pkg.version}`,
      license: pkg.license,
      directory: join(root, "node_modules", name),
      source: pkg.resolved,
    });
  }
  const blocks = [
    "PLVS COMPONENT LICENSES AND NOTICES",
    "",
    "Original upstream notices, collected for the locked dependency versions.",
    "This is a conservative cross-platform inventory; presence does not imply inclusion in every binary.",
    "For MPL-2.0 components, the Source URL provides the corresponding unmodified source under MPL-2.0.",
    "",
  ];
  const seen = new Set();
  const proposed = {
    schemaVersion: 1,
    components: {},
    tools: sortedTools,
    restrictedPackages: policy.restrictedPackages || {},
  };
  for (const component of components.sort((a, b) => a.id.localeCompare(b.id, "en"))) {
    if (seen.has(component.id)) continue;
    seen.add(component.id);
    if (!candidate) assertNoRestrictedComponent(component.id, policy.restrictedPackages);
    const review = policy.components[component.id] || { license: component.license };
    if (!candidate) assertReviewed(component, policy.components[component.id]);
    const documents = [];
    for (const file of await collectNoticeFiles(component.directory)) {
      documents.push({
        name: file,
        text: normalize(await readFile(join(component.directory, file), "utf8")),
      });
    }
    for (const file of review.localFiles || []) {
      documents.push({
        name: file,
        text: normalize(await readFile(join(component.directory, file), "utf8")),
      });
    }
    for (const extra of review.supplements || []) {
      const bytes = await readFile(join(root, extra.file));
      if (digest(bytes) !== extra.sha256) throw new Error(`Changed upstream notice: ${extra.file}`);
      documents.push({
        name: `${extra.file} (${extra.url})`,
        text: normalize(bytes.toString("utf8")),
      });
    }
    if (!documents.length && !candidate)
      throw new Error(`No original license material: ${component.id}`);
    const fingerprint = digest(JSON.stringify(documents));
    proposed.components[component.id] = {
      ...review,
      license: component.license,
      noticeSha256: documents.length ? fingerprint : null,
    };
    if (review.noticeSha256 !== fingerprint && !candidate)
      throw new Error(`Unreviewed notice content: ${component.id}; actual SHA-256 ${fingerprint}`);
    blocks.push(
      "=".repeat(72),
      component.id,
      `Declared license: ${component.license}`,
      `Source: ${component.source}`,
      ""
    );
    for (const document of documents) blocks.push(`--- ${document.name} ---`, document.text, "");
  }
  for (const id of Object.keys(policy.components)) {
    if (!seen.has(id) && !candidate) throw new Error(`Stale reviewed component: ${id}`);
  }
  if (candidate) return JSON.stringify(proposed, null, 2) + "\n";
  return blocks.join("\n");
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--candidate") {
    // Print only; never accept a new license merely by refreshing generated files.
    process.stdout.write(await generateComponentNotices({ candidate: true }));
    return;
  }
  if (!["--write", "--check"].includes(mode))
    throw new Error("Usage: generate-component-notices.mjs --write|--check|--candidate");
  const generated = await generateComponentNotices();
  const path = join(root, "licenses/COMPONENT-NOTICES.txt");
  if (mode === "--write") await writeFile(path, generated);
  else if (normalize(await readFile(path, "utf8")) !== generated)
    throw new Error("Component notices are stale; run npm run licenses:generate");
  console.log("Component license materials verified");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
