import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPaths, inspectChanges } from "./check-changes.mjs";

describe("change scope", () => {
  it("allows website code and guide edits, but rejects mixed, shared and unknown inputs", () => {
    expect(
      classifyPaths([
        "website/assets/sharesets.css",
        "docs/user/intro.md",
        "scripts/build-website.mjs",
      ]).scope
    ).toBe("website");
    for (const file of [
      "src/App.jsx",
      "src-tauri/Cargo.toml",
      "package-lock.json",
      ".github/workflows/ci.yml",
      "scripts/check-changes.mjs",
      "scripts/new-generator.mjs",
      "website/CNAME",
      "website/.config.js",
    ]) {
      expect(classifyPaths(["website/index.html", file]).scope).toBe("full");
    }
    expect(classifyPaths([]).scope).toBe("full");
  });

  it("covers all pending commits, reverted changes, renames, untracked and staged files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "plvs-check-changes-"));
    const git = (...args) =>
      execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
    const write = (path, content) => writeFileSync(join(cwd, path), content);
    const commit = () => {
      git("add", ".");
      git("commit", "-m", "fixture");
      return git("rev-parse", "HEAD");
    };
    try {
      git("init");
      git("config", "user.name", "Test");
      git("config", "user.email", "test@example.com");
      mkdirSync(join(cwd, "website"));
      write("website/index.html", "before");
      write("shared.js", "before");
      const base = commit();
      write("shared.js", "changed");
      commit();
      write("shared.js", "before");
      commit();
      write("website/index.html", "after");
      commit();
      expect(inspectChanges({ base, cwd, working: false }).scope).toBe("full");
      const cleanBase = git("rev-parse", "HEAD");
      write("website/index.html", "another");
      commit();
      expect(inspectChanges({ base: cleanBase, cwd }).scope).toBe("website");
      write("shared.js", "staged change");
      git("add", "shared.js");
      write("shared.js", "before");
      expect(inspectChanges({ base: cleanBase, cwd }).scope).toBe("full");
      git("reset", "--hard", "HEAD");
      write("new.config", "untracked");
      expect(inspectChanges({ base: cleanBase, cwd }).scope).toBe("full");
      git("add", "new.config");
      expect(inspectChanges({ base: cleanBase, cwd }).scope).toBe("full");
      git("reset", "--hard", "HEAD");
      git("mv", "shared.js", "website/shared.js");
      commit();
      expect(inspectChanges({ base: cleanBase, cwd, working: false }).scope).toBe("full");
      expect(inspectChanges({ base: "missing", cwd }).scope).toBe("full");
      expect(inspectChanges({ base: "HEAD", head: base, cwd }).scope).toBe("full");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
