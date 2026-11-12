import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPaths, inspectChanges } from "./check-changes.mjs";

describe("change scope", () => {
  it("separates contracts, frontend and native lanes", () => {
    expect(
      classifyPaths([
        "docs/user/intro.md",
        "docs/privacy-policy.html",
        "scripts/export-website-inputs.mjs",
      ])
    ).toMatchObject({
      scope: "contracts",
      lanes: { contracts: true, frontend: false, native: false },
    });
    expect(classifyPaths(["CONTRIBUTING.md", "scripts/release-package-smoke.mjs"])).toMatchObject({
      scope: "contracts",
      lanes: { contracts: true, frontend: false, native: false },
    });
    expect(classifyPaths(["src/App.jsx", "docs/history/notes/a.md"])).toMatchObject({
      scope: "frontend",
      lanes: { contracts: true, frontend: true, native: false },
    });
    for (const file of [
      "package-lock.json",
      "shared/channel-layouts.json",
      "scripts/check-changes.mjs",
      "new-root.config",
    ]) {
      expect(classifyPaths([file])).toMatchObject({
        scope: "native",
        lanes: { contracts: true, frontend: true, native: true },
      });
    }
    expect(classifyPaths(["src-tauri/Cargo.toml"])).toMatchObject({
      scope: "native",
      lanes: {
        contracts: true,
        frontend: false,
        native: true,
        package_windows: true,
        package_macos: true,
        package_linux: true,
      },
    });
    expect(classifyPaths([])).toMatchObject({
      scope: "native",
      lanes: {
        contracts: true,
        frontend: true,
        native: true,
        package_windows: true,
        package_macos: true,
        package_linux: true,
      },
    });
  });

  it("exercises native jobs when the owning CI workflow changes", () => {
    expect(classifyPaths([".github/workflows/ci.yml"])).toMatchObject({
      scope: "native",
      lanes: { contracts: true, native: true },
    });
  });

  it("selects package checks symmetrically and by platform", () => {
    for (const file of [
      "package-lock.json",
      "scripts/fetch-ffmpeg-sidecar.mjs",
      "src-tauri/src/doctor.rs",
      ".github/workflows/package-check.yml",
    ]) {
      expect(classifyPaths([file]).lanes).toMatchObject({
        package_windows: true,
        package_macos: true,
        package_linux: true,
      });
    }
    expect(classifyPaths(["src-tauri/nsis/installer-hooks.nsh"]).lanes).toMatchObject({
      package_windows: true,
      package_macos: false,
      package_linux: false,
    });
    expect(classifyPaths(["src-tauri/tauri.macos.conf.json"]).lanes).toMatchObject({
      package_windows: false,
      package_macos: true,
      package_linux: false,
    });
    expect(classifyPaths(["scripts/verify-linux-desktop.py"]).lanes).toMatchObject({
      package_windows: false,
      package_macos: false,
      package_linux: true,
    });
    expect(classifyPaths(["new-root.config"]).lanes).toMatchObject({
      package_windows: true,
      package_macos: true,
      package_linux: true,
    });
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
      expect(inspectChanges({ base, cwd, working: false }).scope).toBe("native");
      const cleanBase = git("rev-parse", "HEAD");
      write("website/index.html", "another");
      commit();
      expect(inspectChanges({ base: cleanBase, cwd }).scope).toBe("contracts");
      write("shared.js", "staged change");
      git("add", "shared.js");
      write("shared.js", "before");
      expect(inspectChanges({ base: cleanBase, cwd }).scope).toBe("native");
      git("reset", "--hard", "HEAD");
      write("new.config", "untracked");
      expect(inspectChanges({ base: cleanBase, cwd }).scope).toBe("native");
      git("add", "new.config");
      expect(inspectChanges({ base: cleanBase, cwd }).scope).toBe("native");
      git("reset", "--hard", "HEAD");
      git("mv", "shared.js", "website/shared.js");
      commit();
      expect(inspectChanges({ base: cleanBase, cwd, working: false }).scope).toBe("native");
      expect(inspectChanges({ base: "missing", cwd }).scope).toBe("native");
      expect(inspectChanges({ base: "HEAD", head: base, cwd }).scope).toBe("native");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
