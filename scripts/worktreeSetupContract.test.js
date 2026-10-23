import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));

describe("worktree setup contract", () => {
  it("prepares linked worktrees during the normal dependency install", () => {
    expect(packageJson.scripts.prepare).toContain("simple-git-hooks");
    expect(packageJson.scripts.prepare).toContain("node scripts/prepare-linked-worktree.mjs");
    expect(packageJson.scripts["worktree:setup"]).toBe("npm ci && npm run worktree:doctor");
    expect(packageJson.scripts["worktree:doctor"]).toBe("node scripts/worktree-doctor.mjs");
  });

  it.each([
    "benchmark:vectorscope-rust",
    "benchmark:stereo-map-rust",
    "rust:clippy",
    "rust:test",
    "rust:check",
    "verify:loudness-reference",
  ])("makes %s restore verified sidecars before Cargo", (name) => {
    expect(packageJson.scripts[name]).toMatch(/^npm run ffmpeg:fetch && /);
  });
});
