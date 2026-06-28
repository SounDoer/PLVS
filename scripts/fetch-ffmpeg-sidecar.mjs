#!/usr/bin/env node
// Fetches the trimmed FFmpeg sidecar binaries from the dedicated GitHub Release into
// `src-tauri/binaries/`. Idempotent: a file already present with the expected SHA-256 is skipped,
// so this is safe to run before every desktop build. See docs/ffmpeg-sidecar-build.md.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "ffmpeg-sidecar-7.1";
const REPO = "SounDoer/PLVS";
const BASE = `https://github.com/${REPO}/releases/download/${TAG}`;

// Per-platform sidecar assets. Only Windows is published in this phase.
const ASSETS = {
  win32: [
    {
      name: "ffmpeg-x86_64-pc-windows-msvc.exe",
      sha256: "56687550c76f7c58843b513a859bc20bac23024d50f5f61262441a2972ff7a3f",
    },
    {
      name: "ffprobe-x86_64-pc-windows-msvc.exe",
      sha256: "411c157144e52430c189e3e30811b89fa4727befb67af27c868c055be206d21b",
    },
  ],
  darwin: [
    {
      name: "ffmpeg-aarch64-apple-darwin",
      sha256: "624621795ba3ccbe98b8e752333d2a38f069b3652481f5166cf2252d772676ce",
    },
    {
      name: "ffprobe-aarch64-apple-darwin",
      sha256: "c28b47f20d0e2e360ca835a1cc5ed4df36db71aa6b2d2bf4da4e487ff7cca01e",
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

async function ensureAsset({ name, sha256: expected }) {
  const dest = join(outDir, name);
  if (existsSync(dest) && (await fileSha256(dest)) === expected) {
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
  console.log(`✓ ${name} downloaded and verified (${buf.length} bytes)`);
}

async function main() {
  const assets = ASSETS[process.platform];
  if (!assets) {
    console.warn(
      `! No FFmpeg sidecar binaries are published for platform "${process.platform}" yet; ` +
        `File-mode decoding will be unavailable in a build on this platform.`
    );
    return; // Do not fail — this phase ships Windows only.
  }
  await mkdir(outDir, { recursive: true });
  for (const asset of assets) await ensureAsset(asset);
}

main().catch((err) => {
  console.error(`FFmpeg sidecar fetch failed: ${err.message}`);
  process.exit(1);
});
