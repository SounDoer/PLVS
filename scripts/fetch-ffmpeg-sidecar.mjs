#!/usr/bin/env node
// Fetches the trimmed FFmpeg sidecar binaries from the dedicated GitHub Release into
// `src-tauri/binaries/`. Idempotent: a file already present with the expected SHA-256 is skipped,
// so this is safe to run before every desktop build. See docs/ffmpeg-sidecar-build.md.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "ffmpeg-sidecar-7.1.5-r1";
const REPO = "SounDoer/PLVS";
const BASE = `https://github.com/${REPO}/releases/download/${TAG}`;

// Immutable per-platform sidecar assets; corresponding source is pinned in licenses/native-components.json.
const ASSETS = {
  win32: [
    {
      name: "ffmpeg-x86_64-pc-windows-msvc.exe",
      sha256: "3838d8d993aae815e6997d382251f2e8f46f9bfcadc7372897be9cb4d7e5587e",
    },
    {
      name: "ffprobe-x86_64-pc-windows-msvc.exe",
      sha256: "66d1a28dd3c47493c1e1a398f6fa7a06f801e51a00a205e8f2828b528e9300df",
    },
  ],
  darwin: [
    {
      name: "ffmpeg-aarch64-apple-darwin",
      sha256: "0228de86396bea71a1fe28c61e816832b766f6f7cca7e49321f424a21536da89",
    },
    {
      name: "ffprobe-aarch64-apple-darwin",
      sha256: "c660df55e4d3b444eae7bce3db245c8e6df7c9d41d855161be077bfd15d44f5d",
    },
  ],
  linux: [
    {
      name: "ffmpeg-x86_64-unknown-linux-gnu",
      sha256: "cc9c0c7de5452d1c4e9344aeab252aa80ffc7eb2651466ee3a56a8cdce1e6daa",
    },
    {
      name: "ffprobe-x86_64-unknown-linux-gnu",
      sha256: "8c8fdc15d2d26538d02972887abab1b0bf4f75994480a10bf6a958c02f7ed33d",
    },
  ],
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "binaries");

async function fileSha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function verifyRuntime(dest, name) {
  if (process.platform === "darwin") {
    const linked = spawnSync("otool", ["-L", dest], { encoding: "utf8", timeout: 10_000 });
    if (linked.status !== 0) {
      throw new Error(`could not inspect dynamic-library dependencies for ${name}`);
    }
    const unexpected = linked.stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/, 1)[0])
      .filter(Boolean)
      .filter((path) => !path.startsWith("/usr/lib/") && !path.startsWith("/System/Library/"));
    if (unexpected.length) {
      throw new Error(
        `${name} is not portable: it links to non-system libraries:\n  ${unexpected.join("\n  ")}`
      );
    }
  }
  if (process.platform === "linux") {
    if (process.arch !== "x64") {
      throw new Error(`no reviewed Linux sidecar is available for architecture ${process.arch}`);
    }
    const header = spawnSync("readelf", ["-h", dest], { encoding: "utf8", timeout: 10_000 });
    if (
      header.status !== 0 ||
      !/Class:\s+ELF64/.test(header.stdout) ||
      !/Machine:\s+Advanced Micro Devices X86-64/.test(header.stdout)
    ) {
      throw new Error(`${name} is not a reviewed Linux x86_64 ELF binary`);
    }
    const dynamic = spawnSync("readelf", ["-d", dest], { encoding: "utf8", timeout: 10_000 });
    if (dynamic.status !== 0) {
      throw new Error(`could not inspect dynamic-library dependencies for ${name}`);
    }
    const allowed = new Set(["libc.so.6", "libm.so.6"]);
    const dependencies = [...dynamic.stdout.matchAll(/\(NEEDED\).*Shared library: \[([^\]]+)\]/g)].map(
      (match) => match[1]
    );
    const unexpected = dependencies.filter((dependency) => !allowed.has(dependency));
    if (unexpected.length) {
      throw new Error(
        `${name} is not portable: it links to unreviewed libraries:\n  ${unexpected.join("\n  ")}`
      );
    }
    const versions = spawnSync("readelf", ["--version-info", dest], {
      encoding: "utf8",
      timeout: 10_000,
    });
    if (versions.status !== 0) throw new Error(`could not inspect glibc versions for ${name}`);
    const tooNew = [...versions.stdout.matchAll(/GLIBC_(\d+)\.(\d+)/g)].some(
      ([, major, minor]) => Number(major) > 2 || (Number(major) === 2 && Number(minor) > 39)
    );
    if (tooNew) throw new Error(`${name} requires a glibc version newer than Ubuntu 24.04`);
  }
  const version = spawnSync(dest, ["-version"], { encoding: "utf8", timeout: 10_000 });
  if (version.status !== 0) {
    const detail =
      version.error?.message || (version.stderr ?? "").trim() || `exit status ${version.status}`;
    throw new Error(`${name} passed its checksum but cannot run: ${detail}`);
  }
  const license = spawnSync(dest, ["-L"], { encoding: "utf8", timeout: 10_000 });
  const licenseOutput = `${license.stdout || ""}\n${license.stderr || ""}`;
  if (
    license.status !== 0 ||
    !licenseOutput.includes("GNU Lesser General Public") ||
    !licenseOutput.includes("version 2.1") ||
    /--enable-(gpl|nonfree)/.test(licenseOutput)
  ) {
    throw new Error(`${name} does not report the reviewed LGPL-2.1-or-later configuration`);
  }
}

async function ensureAsset({ name, sha256: expected }) {
  const dest = join(outDir, name);
  if (existsSync(dest) && (await fileSha256(dest)) === expected) {
    verifyRuntime(dest, name);
    console.log(`✓ ${name} present and verified`);
    return;
  }
  const url = `${BASE}/${name}`;
  console.log(`↓ downloading ${name} …`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== expected) {
    throw new Error(`checksum mismatch for ${name}\n  expected ${expected}\n  got      ${got}`);
  }
  await writeFile(dest, buf);
  if (process.platform !== "win32") await chmod(dest, 0o755); // sidecars must be executable on Unix
  verifyRuntime(dest, name);
  console.log(`✓ ${name} downloaded and verified (${buf.length} bytes)`);
}

async function main() {
  const assets = ASSETS[process.platform];
  if (!assets) {
    console.warn(
      `! No FFmpeg sidecar binaries are published for platform "${process.platform}" yet; ` +
        `File-mode decoding will be unavailable in a build on this platform.`
    );
    return;
  }
  await mkdir(outDir, { recursive: true });
  for (const asset of assets) await ensureAsset(asset);
}

main().catch((err) => {
  console.error(`FFmpeg sidecar fetch failed: ${err.message}`);
  process.exit(1);
});
