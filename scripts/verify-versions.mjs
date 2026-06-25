/**
 * Ensures root package.json "version" matches:
 * - src-tauri/Cargo.toml [package].version
 * - src-tauri/tauri.conf.json "version"
 * - package-lock.json root "version" (top-level + packages[""])
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const pkgVersion = pkg.version;

const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
const cargo = fs.readFileSync(cargoPath, "utf8");

const pkgIdx = cargo.indexOf("[package]");
if (pkgIdx === -1) {
  console.error("Cargo.toml: [package] section not found");
  process.exit(1);
}
const after = cargo.slice(pkgIdx);
const nextSection = after.search(/\n\[/);
const block = nextSection === -1 ? after : after.slice(0, nextSection);
const m = block.match(/^\s*version\s*=\s*"([^"]+)"/m);
if (!m) {
  console.error("Cargo.toml: package version not found in [package] block");
  process.exit(1);
}
const cargoVersion = m[1];

const tauriConfPath = path.join(root, "src-tauri", "tauri.conf.json");
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
const tauriVersion = tauriConf.version;
if (typeof tauriVersion !== "string") {
  console.error("tauri.conf.json: missing string \"version\"");
  process.exit(1);
}

// package-lock.json — root version mirrors in top-level + packages[""]
const lockPath = path.join(root, "package-lock.json");
let lockVersion;
try {
  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
  const top = typeof lock.version === "string" ? lock.version : undefined;
  const rootPkg = lock.packages?.[""]?.version;
  if (top !== rootPkg) {
    console.error("package-lock.json: top-level version and packages[\"\"].version disagree");
    console.error(`  version            ${top}`);
    console.error(`  packages[""].version  ${rootPkg}`);
    process.exit(1);
  }
  lockVersion = top;
} catch (e) {
  console.error("package-lock.json: not found or unreadable");
  process.exit(1);
}

if (
  pkgVersion !== cargoVersion ||
  pkgVersion !== tauriVersion ||
  pkgVersion !== lockVersion
) {
  console.error(
    "Version mismatch — package.json, src-tauri/Cargo.toml [package], src-tauri/tauri.conf.json, package-lock.json must match:",
  );
  console.error(`  package.json      ${pkgVersion}`);
  console.error(`  Cargo.toml        ${cargoVersion}`);
  console.error(`  tauri.conf.json   ${tauriVersion}`);
  console.error(`  package-lock.json ${lockVersion}`);
  process.exit(1);
}

console.log(`Versions OK (${pkgVersion})`);
