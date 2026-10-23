import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadWithRetry, ensureAsset, ffmpegCacheDirectory } from "./fetch-ffmpeg-sidecar.mjs";

const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "plvs-ffmpeg-fetch-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function response(bytes, { ok = true, status = 200 } = {}) {
  const body = Uint8Array.from(bytes);
  return { ok, status, arrayBuffer: async () => body.buffer };
}

const silentLog = { log: vi.fn(), warn: vi.fn() };

afterEach(() => {
  vi.clearAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("FFmpeg sidecar cache", () => {
  it("honors the override and chooses each platform's user cache directory", () => {
    const override = join(temporaryDirectory(), "shared-ffmpeg");
    expect(ffmpegCacheDirectory({ platform: "linux", env: { PLVS_FFMPEG_CACHE: override } })).toBe(
      override
    );
    expect(ffmpegCacheDirectory({ platform: "linux", env: {}, home: "/home/test" })).toBe(
      join("/home/test", ".cache", "plvs", "ffmpeg-sidecars")
    );
    expect(
      ffmpegCacheDirectory({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" },
        home: "unused",
      })
    ).toBe(join("C:\\Users\\test\\AppData\\Local", "PLVS", "ffmpeg-sidecars"));
    expect(ffmpegCacheDirectory({ platform: "darwin", env: {}, home: "/Users/test" })).toBe(
      join("/Users/test", "Library", "Caches", "PLVS", "ffmpeg-sidecars")
    );
  });

  it("copies a checksum-verified cache entry without using the network", async () => {
    const root = temporaryDirectory();
    const outputDirectory = join(root, "output");
    const cacheDirectory = join(root, "cache");
    const bytes = Buffer.from("reviewed sidecar");
    const asset = { name: "ffmpeg-test", sha256: sha256(bytes) };
    const cached = join(cacheDirectory, "ffmpeg-sidecar-7.1.5-r1", asset.name);
    await mkdir(join(cacheDirectory, "ffmpeg-sidecar-7.1.5-r1"), { recursive: true });
    writeFileSync(cached, bytes);
    const fetchImpl = vi.fn();
    const verifyRuntimeImpl = vi.fn();

    await ensureAsset(asset, {
      outputDirectory,
      cacheDirectory,
      platform: "linux",
      fetchImpl,
      verifyRuntimeImpl,
      log: silentLog,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readFileSync(join(outputDirectory, asset.name))).toEqual(bytes);
    expect(verifyRuntimeImpl).toHaveBeenCalledOnce();
  });

  it("replaces a corrupt Windows destination with the verified cache entry", async () => {
    const root = temporaryDirectory();
    const outputDirectory = join(root, "output");
    const cacheDirectory = join(root, "cache");
    const bytes = Buffer.from("reviewed Windows sidecar");
    const asset = { name: "ffmpeg-test.exe", sha256: sha256(bytes) };
    const cached = join(cacheDirectory, "ffmpeg-sidecar-7.1.5-r1", asset.name);
    await mkdir(outputDirectory, { recursive: true });
    await mkdir(join(cacheDirectory, "ffmpeg-sidecar-7.1.5-r1"), { recursive: true });
    writeFileSync(join(outputDirectory, asset.name), "corrupt destination");
    writeFileSync(cached, bytes);

    await ensureAsset(asset, {
      outputDirectory,
      cacheDirectory,
      platform: "win32",
      fetchImpl: vi.fn(),
      verifyRuntimeImpl: vi.fn(),
      log: silentLog,
    });

    expect(readFileSync(join(outputDirectory, asset.name))).toEqual(bytes);
  });

  it("ignores a corrupt cache entry, downloads, and safely replaces the cache", async () => {
    const root = temporaryDirectory();
    const outputDirectory = join(root, "output");
    const cacheDirectory = join(root, "cache");
    const bytes = Buffer.from("fresh reviewed sidecar");
    const asset = { name: "ffprobe-test", sha256: sha256(bytes) };
    const cached = join(cacheDirectory, "ffmpeg-sidecar-7.1.5-r1", asset.name);
    await mkdir(join(cacheDirectory, "ffmpeg-sidecar-7.1.5-r1"), { recursive: true });
    writeFileSync(cached, "corrupt");
    const fetchImpl = vi.fn().mockResolvedValue(response(bytes));

    await ensureAsset(asset, {
      outputDirectory,
      cacheDirectory,
      platform: "win32",
      fetchImpl,
      verifyRuntimeImpl: vi.fn(),
      log: silentLog,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(readFileSync(join(outputDirectory, asset.name))).toEqual(bytes);
    expect(readFileSync(cached)).toEqual(bytes);
    expect(silentLog.warn).toHaveBeenCalledWith(expect.stringContaining("checksum mismatch"));
  });

  it("does not install or cache a download with the wrong checksum", async () => {
    const root = temporaryDirectory();
    const outputDirectory = join(root, "output");
    const cacheDirectory = join(root, "cache");
    const asset = { name: "ffmpeg-test", sha256: sha256(Buffer.from("expected")) };

    await expect(
      ensureAsset(asset, {
        outputDirectory,
        cacheDirectory,
        fetchImpl: vi.fn().mockResolvedValue(response(Buffer.from("wrong"))),
        verifyRuntimeImpl: vi.fn(),
        log: silentLog,
      })
    ).rejects.toThrow(/checksum mismatch/);

    expect(existsSync(join(outputDirectory, asset.name))).toBe(false);
    expect(existsSync(join(cacheDirectory, "ffmpeg-sidecar-7.1.5-r1", asset.name))).toBe(false);
  });
});

describe("FFmpeg sidecar download retries", () => {
  it("retries network failures three times with exponential backoff", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket reset"))
      .mockResolvedValueOnce(response([], { ok: false, status: 503 }))
      .mockResolvedValueOnce(response(Buffer.from("ok")));
    const sleepImpl = vi.fn();

    await expect(
      downloadWithRetry("https://example.invalid/ffmpeg", {
        fetchImpl,
        sleepImpl,
        log: silentLog,
      })
    ).resolves.toEqual(Buffer.from("ok"));

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleepImpl.mock.calls).toEqual([[1_000], [2_000]]);
  });

  it("does not retry a permanent HTTP error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response([], { ok: false, status: 404 }));
    const sleepImpl = vi.fn();

    await expect(
      downloadWithRetry("https://example.invalid/missing", {
        fetchImpl,
        sleepImpl,
        log: silentLog,
      })
    ).rejects.toThrow(/404/);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleepImpl).not.toHaveBeenCalled();
  });
});
