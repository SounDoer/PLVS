#!/usr/bin/env node
// Fetches the trimmed FFmpeg sidecar binaries from the dedicated GitHub Release into
// `src-tauri/binaries/`. Idempotent: a file already present with the expected SHA-256 is skipped,
// so this is safe to run before every desktop build. Verified downloads are cached outside the
// checkout; set PLVS_FFMPEG_CACHE to override the platform user-cache location. See
// docs/ffmpeg-sidecar-build.md.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "ffmpeg-sidecar-7.1.5-r2";
const REPO = "SounDoer/PLVS";
const BASE = `https://github.com/${REPO}/releases/download/${TAG}`;

// Immutable per-platform sidecar assets; corresponding source is pinned in licenses/native-components.json.
const ASSETS = {
  win32: [
    {
      name: "ffmpeg-x86_64-pc-windows-msvc.exe",
      sha256: "a04aa4999e61082383e0203f45b9b8cafb2e01baba6ca0cb70235718908499fc",
    },
    {
      name: "ffprobe-x86_64-pc-windows-msvc.exe",
      sha256: "b3e3ce7de4eb33cba0caaea85b10b269bb68d0fb72863fb2b40f9f3eb3636623",
    },
  ],
  darwin: [
    {
      name: "ffmpeg-aarch64-apple-darwin",
      sha256: "3cc9c94ab5a7a5065b1e07a4a3d9e2644f392acc289cb505914ed7a4efcb8c63",
    },
    {
      name: "ffprobe-aarch64-apple-darwin",
      sha256: "7afc063ca222cbe1457c8a031225e4a3bac123524ffac735825b749ae4a8c430",
    },
  ],
  linux: [
    {
      name: "ffmpeg-x86_64-unknown-linux-gnu",
      sha256: "215d79534ba277e1589b36f8ce4af4af1e4561fc36c4482c6b72338e78072570",
    },
    {
      name: "ffprobe-x86_64-unknown-linux-gnu",
      sha256: "46e0b687894579f379da78e9eec048ca39f9d3053738f5c8aa293909d402ee88",
    },
  ],
};

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src-tauri", "binaries");

export function ffmpegCacheDirectory({
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  if (env.PLVS_FFMPEG_CACHE?.trim()) return resolve(env.PLVS_FFMPEG_CACHE);
  if (platform === "win32") {
    return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "PLVS", "ffmpeg-sidecars");
  }
  if (platform === "darwin") return join(home, "Library", "Caches", "PLVS", "ffmpeg-sidecars");
  return join(env.XDG_CACHE_HOME || join(home, ".cache"), "plvs", "ffmpeg-sidecars");
}

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
    const dependencies = [
      ...dynamic.stdout.matchAll(/\(NEEDED\).*Shared library: \[([^\]]+)\]/g),
    ].map((match) => match[1]);
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

async function writeAtomically(path, bytes, platform) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await writeFile(temporary, bytes);
    if (platform !== "win32") await chmod(temporary, 0o755);
    try {
      await rename(temporary, path);
    } catch (error) {
      if (platform !== "win32" || !["EEXIST", "EPERM"].includes(error.code)) throw error;

      // Windows rename does not reliably replace an existing file. Preserve the old file until
      // the new one is in place so a failed replacement does not leave the destination missing.
      const previous = `${temporary}.previous`;
      await rename(path, previous);
      try {
        await rename(temporary, path);
      } catch (replacementError) {
        await rename(previous, path);
        throw replacementError;
      }
      await rm(previous, { force: true });
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function downloadWithRetry(
  url,
  {
    fetchImpl = fetch,
    sleepImpl = (ms) => new Promise((done) => setTimeout(done, ms)),
    log = console,
  } = {}
) {
  const attempts = 3;
  let lastError;
  let attemptsUsed = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attemptsUsed = attempt;
    try {
      const response = await fetchImpl(url, { redirect: "follow" });
      if (!response.ok) {
        const error = new Error(`download failed (${response.status}) for ${url}`);
        error.retryable = retryableStatus(response.status);
        throw error;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === attempts) break;
      const delay = 1_000 * 2 ** (attempt - 1);
      log.warn(
        `! download attempt ${attempt}/${attempts} failed: ${error.message}; retrying in ${delay} ms`
      );
      await sleepImpl(delay);
    }
  }
  const count = `${attemptsUsed} attempt${attemptsUsed === 1 ? "" : "s"}`;
  throw new Error(`download failed after ${count} for ${url}: ${lastError.message}`);
}

export async function ensureAsset(
  { name, sha256: expected },
  {
    outputDirectory = outDir,
    cacheDirectory = ffmpegCacheDirectory(),
    platform = process.platform,
    fetchImpl = fetch,
    sleepImpl,
    verifyRuntimeImpl = verifyRuntime,
    log = console,
  } = {}
) {
  const dest = join(outputDirectory, name);
  if (existsSync(dest) && (await fileSha256(dest)) === expected) {
    verifyRuntimeImpl(dest, name);
    log.log(`✓ ${name} present and verified`);
    return;
  }

  const cached = join(cacheDirectory, TAG, name);
  if (existsSync(cached)) {
    if ((await fileSha256(cached)) === expected) {
      const bytes = await readFile(cached);
      await writeAtomically(dest, bytes, platform);
      const installed = await fileSha256(dest);
      if (installed !== expected) {
        throw new Error(`checksum mismatch after copying cached ${name}`);
      }
      verifyRuntimeImpl(dest, name);
      log.log(`✓ ${name} restored from verified cache`);
      return;
    }
    log.warn(`! ignoring cached ${name}: checksum mismatch`);
  }

  const url = `${BASE}/${name}`;
  log.log(`↓ downloading ${name} …`);
  const buf = await downloadWithRetry(url, { fetchImpl, sleepImpl, log });
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== expected) {
    throw new Error(`checksum mismatch for ${name}\n  expected ${expected}\n  got      ${got}`);
  }
  await writeAtomically(dest, buf, platform);
  if ((await fileSha256(dest)) !== expected) {
    throw new Error(`checksum mismatch after installing ${name}`);
  }
  verifyRuntimeImpl(dest, name);
  try {
    await writeAtomically(cached, buf, platform);
    if ((await fileSha256(cached)) !== expected) {
      throw new Error(`checksum mismatch after caching ${name}`);
    }
  } catch (error) {
    log.warn(`! could not cache ${name}: ${error.message}`);
  }
  log.log(`✓ ${name} downloaded and verified (${buf.length} bytes)`);
}

export async function main() {
  const assets = ASSETS[process.platform];
  if (!assets) {
    console.warn(
      `! No FFmpeg sidecar binaries are published for platform "${process.platform}" yet; ` +
        `File-mode decoding will be unavailable in a build on this platform.`
    );
    return;
  }
  await mkdir(outDir, { recursive: true });
  const cacheDirectory = ffmpegCacheDirectory();
  for (const asset of assets) await ensureAsset(asset, { cacheDirectory });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`FFmpeg sidecar fetch failed: ${err.message}`);
    process.exit(1);
  });
}
