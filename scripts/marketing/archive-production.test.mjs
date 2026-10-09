import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  unlink,
  copyFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planArchive, applyArchive, verifyArchive } from "./archive-production.mjs";

describe("production archive", () => {
  let root, source, destination;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "plvs-archive-"));
    source = join(root, "production");
    destination = join(root, "archive");
    await mkdir(source);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });
  const file = async (root, path, body) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), body);
  };

  it("preserves unknown files, project paths, and same-named files with different content", async () => {
    await file(source, "video/public/take.mp4", "first");
    await file(source, "old/take.mp4", "second");
    await file(source, "notes.txt", "unknown but valuable");
    await file(source, "node_modules/cache", "reinstallable");
    const plan = await planArchive({
      source,
      destination,
      rules: [{ path: "node_modules", action: "omit" }],
    });
    expect(plan.entries.filter((e) => e.action === "keep")).toHaveLength(3);
    await applyArchive(plan);
    expect((await verifyArchive(destination)).status).toBe("passed");
    expect(await readFile(join(destination, "files/video/public/take.mp4"), "utf8")).toBe("first");
    expect(await readFile(join(destination, "files/old/take.mp4"), "utf8")).toBe("second");
    expect(await readFile(join(source, "node_modules/cache"), "utf8")).toBe("reinstallable");
  });

  it("deduplicates only explicit pools and records every source mapping", async () => {
    await file(source, "assets/a.mp4", "same");
    await file(source, "assets/b.mp4", "same");
    await file(source, "extra/a.mp4", "same");
    await file(source, "extra/b.mp4", "same");
    const plan = await planArchive({
      source,
      destination,
      rules: [{ path: "extra", action: "keep", to: "history/raw", deduplicate: true }],
    });
    expect(plan.entries.filter((e) => e.deduplicated)).toHaveLength(1);
    await applyArchive(plan);
    expect((await verifyArchive(destination)).files).toBe(3);
  });

  it("refuses stale or edited plans before creating an archive", async () => {
    await file(source, "a", "old");
    const plan = await planArchive({ source, destination });
    await file(source, "a", "new");
    await expect(applyArchive(plan)).rejects.toThrow("stale");
    await expect(readFile(join(destination, "archive-report.json"))).rejects.toThrow();
    const fresh = await planArchive({ source, destination });
    fresh.entries[0].target = "../outside";
    await expect(applyArchive(fresh)).rejects.toThrow("modified");
  });

  it("rejects target collisions, overlapping rules, missing rules and nested roots", async () => {
    await file(source, "a", "one");
    await file(source, "b", "two");
    await expect(
      planArchive({
        source,
        destination,
        rules: [
          { path: "a", action: "keep", to: "same" },
          { path: "b", action: "keep", to: "SAME" },
        ],
      })
    ).rejects.toThrow("collision");
    await expect(
      planArchive({
        source,
        destination,
        rules: [
          { path: "a", action: "keep", to: "same" },
          { path: "b", action: "keep", to: "same/child" },
        ],
      })
    ).rejects.toThrow("collision");
    await expect(
      planArchive({
        source,
        destination,
        rules: [
          { path: "a", action: "omit" },
          { path: "a/child", action: "keep" },
        ],
      })
    ).rejects.toThrow("Overlapping");
    await expect(
      planArchive({ source, destination, rules: [{ path: "missing", action: "omit" }] })
    ).rejects.toThrow("no source");
    await expect(planArchive({ source, destination: join(source, "archive") })).rejects.toThrow(
      "non-nested"
    );
  });

  it("refuses existing destinations and path traversal", async () => {
    await file(source, "a", "one");
    await expect(
      planArchive({ source, destination, rules: [{ path: "a", action: "keep", to: "../escape" }] })
    ).rejects.toThrow("Unsafe");
    const plan = await planArchive({ source, destination });
    await mkdir(destination);
    await file(destination, "precious", "keep me");
    await expect(applyArchive(plan)).rejects.toThrow("exists");
    expect(await readFile(join(destination, "precious"), "utf8")).toBe("keep me");
  });

  it("rejects directory links instead of following files outside the source", async () => {
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(source, "link"), process.platform === "win32" ? "junction" : "dir");
    try {
      await expect(planArchive({ source, destination })).rejects.toThrow("links/junctions");
    } finally {
      await unlink(join(source, "link"));
    }
  });

  it("retains a failed partial archive and never deletes source after interruption", async () => {
    await file(source, "a", "one");
    await file(source, "b", "two");
    const plan = await planArchive({ source, destination });
    let n = 0;
    await expect(
      applyArchive(plan, {
        copy: async (...args) => {
          if (++n === 2) throw new Error("disk full");
          await copyFile(...args);
        },
      })
    ).rejects.toThrow("disk full");
    const report = JSON.parse(await readFile(join(destination, "archive-report.json"), "utf8"));
    expect(report.status).toBe("failed");
    expect(await readFile(join(source, "b"), "utf8")).toBe("two");
    await expect(verifyArchive(destination)).rejects.toThrow("incomplete");
  });

  it("detects changes and additions made during copying", async () => {
    await file(source, "a", "one");
    const plan = await planArchive({ source, destination });
    await expect(
      applyArchive(plan, {
        copy: async (...args) => {
          await copyFile(...args);
          await file(source, "new", "late file");
        },
      })
    ).rejects.toThrow("Source changed");
  });

  it("reports altered, missing and unexpected payload files", async () => {
    await file(source, "a", "one");
    await file(source, "b", "two");
    await applyArchive(await planArchive({ source, destination }));
    await file(destination, "files/a", "bad");
    await rm(join(destination, "files/b"));
    await file(destination, "files/new", "extra");
    expect((await verifyArchive(destination)).failures.sort()).toEqual([
      "files/a",
      "files/b",
      "files/new",
    ]);
  });
});
