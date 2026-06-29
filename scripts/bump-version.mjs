#!/usr/bin/env node
/**
 * Bump version across package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json.
 * Usage: node scripts/bump-version.mjs <new-version>
 * Example: node scripts/bump-version.mjs 0.1.2
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const newVersion = process.argv[2]?.trim();
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error("Usage: node scripts/bump-version.mjs <major.minor.patch>");
  console.error("Example: node scripts/bump-version.mjs 0.1.2");
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// package.json
const pkgPath = join(root, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const oldVersion = pkg.version;
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log(`package.json:          ${oldVersion} → ${newVersion}`);

// src-tauri/tauri.conf.json
const tauriConfPath = join(root, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
tauriConf.version = newVersion;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n", "utf8");
console.log(`tauri.conf.json:       ${oldVersion} → ${newVersion}`);

// src-tauri/Cargo.toml — replace only the [package] block's version line
const cargoPath = join(root, "src-tauri", "Cargo.toml");
const cargo = readFileSync(cargoPath, "utf8");
const pkgIdx = cargo.indexOf("[package]");
if (pkgIdx === -1) {
  console.error("Cargo.toml: [package] section not found");
  process.exit(1);
}
const before = cargo.slice(0, pkgIdx);
const after = cargo.slice(pkgIdx);
const nextSection = after.search(/\n\[(?!package)/);
const block = nextSection === -1 ? after : after.slice(0, nextSection);
const rest = nextSection === -1 ? "" : after.slice(nextSection);
const updatedBlock = block.replace(/^(\s*version\s*=\s*)"[^"]+"/m, `$1"${newVersion}"`);
writeFileSync(cargoPath, before + updatedBlock + rest, "utf8");
console.log(`Cargo.toml:            ${oldVersion} → ${newVersion}`);

// Update Cargo.lock
try {
  execSync("cargo update --manifest-path src-tauri/Cargo.toml --workspace", {
    cwd: root,
    stdio: "pipe",
  });
  console.log("Cargo.lock:            updated");
} catch {
  console.warn("Cargo.lock:            skipped (cargo not available)");
}

// package-lock.json — sync root version mirrors (top-level + packages[""])
const lockPath = join(root, "package-lock.json");
try {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  let lockChanged = false;
  if (typeof lock.version === "string" && lock.version !== newVersion) {
    lock.version = newVersion;
    lockChanged = true;
  }
  if (lock.packages?.[""]?.version !== newVersion) {
    lock.packages[""].version = newVersion;
    lockChanged = true;
  }
  if (lockChanged) {
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf8");
    console.log(`package-lock.json:      ${oldVersion} → ${newVersion}`);
  }
} catch {
  console.warn("package-lock.json:      skipped (not found or unreadable)");
}

// Verify
try {
  execSync("node scripts/verify-versions.mjs", { cwd: root, stdio: "inherit" });
} catch {
  process.exit(1);
}

console.log("");
console.log("Next steps:");
console.log(`  1. Update CHANGELOG.md — add ## [${newVersion}] section`);
console.log(`  2. git add -A && git commit -m "chore(release): bump version to ${newVersion}"`);
console.log(`  3. git push`);
console.log(`  4. npm run release:preflight`);
console.log(`  5. git tag v${newVersion} && git push origin v${newVersion}`);
