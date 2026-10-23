import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectWorktree } from "./worktree-doctor.mjs";

const directories = [];

function fixture({ dependencies = true, node = process.version.replace(/^v/, "") } = {}) {
  const root = mkdtempSync(join(tmpdir(), "plvs-worktree-doctor-"));
  directories.push(root);
  writeFileSync(join(root, ".nvmrc"), `${node}\n`);
  writeFileSync(join(root, "rust-toolchain.toml"), '[toolchain]\nchannel = "1.99.0"\n');
  if (dependencies) {
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", ".package-lock.json"), "{}\n");
  }
  return root;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("worktree doctor", () => {
  it("verifies the common linked-worktree environment", async () => {
    const ensure = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn((command) => ({
      status: 0,
      stdout: command === "cargo" ? "cargo 1.99.0 (test)\n" : "rustc 1.99.0 (test)\n",
    }));

    await expect(
      inspectWorktree({
        root: fixture(),
        worktree: "/repo/.codex/worktrees/feature",
        ensure,
        run,
        log: { log: vi.fn() },
      })
    ).resolves.toEqual({
      kind: "linked worktree",
      node: process.version.replace(/^v/, ""),
      cargo: "cargo 1.99.0 (test)",
      rustc: "rustc 1.99.0 (test)",
    });
    expect(ensure).toHaveBeenCalledOnce();
  });

  it("explains stale or absent installed dependencies before checking tools", async () => {
    const ensure = vi.fn();

    await expect(
      inspectWorktree({
        root: fixture({ dependencies: false }),
        worktree: "/repo/.codex/worktrees/feature",
        ensure,
      })
    ).rejects.toThrow(/run npm ci/);
    expect(ensure).not.toHaveBeenCalled();
  });

  it("reports the exact Node version required by the repository", async () => {
    await expect(
      inspectWorktree({
        root: fixture({ node: "0.0.1" }),
        worktree: "/repo/.codex/worktrees/feature",
      })
    ).rejects.toThrow(/Node 0\.0\.1 is required/);
  });
});
