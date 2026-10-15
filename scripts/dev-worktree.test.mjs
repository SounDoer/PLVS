import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  APP_DATA_ROOT_ARG,
  WORKTREE_PORTS,
  chooseWorktreePort,
  gitCommonDir,
  linkedWorktreeRoot,
  portIsFree,
  preferredWorktreePort,
  readBaseTauriConfig,
  scopeDevCliToWorktree,
  worktreeCliIdentityRoot,
  worktreeTauriConfig,
  worktreeTauriDevArgs,
} from "./dev-worktree.mjs";

function git(cwd, ...args) {
  const result = spawnSync(
    "git",
    ["-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    { cwd, encoding: "utf8" }
  );
  if (result.status !== 0) throw new Error(result.stderr);
}

describe("worktree detection", () => {
  let repo;
  let linked;

  beforeAll(() => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), "plvs-dev-worktree-")));
    repo = join(base, "repo");
    linked = join(base, "linked");
    git(base, "init", "-q", repo);
    writeFileSync(join(repo, "file.txt"), "x");
    git(repo, "add", "file.txt");
    git(repo, "commit", "-q", "-m", "init");
    git(repo, "worktree", "add", "-q", "--detach", linked);
    mkdirSync(join(linked, "nested"));
  });

  afterAll(async () => {
    await rm(resolve(repo, ".."), { recursive: true, force: true });
  });

  it("treats the main checkout as not linked", () => {
    expect(linkedWorktreeRoot(repo)).toBeNull();
  });

  it("returns a linked worktree's root, also from a subdirectory", () => {
    expect(linkedWorktreeRoot(linked)).toBe(resolve(linked));
    expect(linkedWorktreeRoot(join(linked, "nested"))).toBe(resolve(linked));
  });

  it("shares one common directory between both checkouts", () => {
    expect(gitCommonDir(linked)).toBe(gitCommonDir(repo));
  });
});

describe("preferredWorktreePort", () => {
  it("is stable for one path and ignores case", () => {
    const path = "C:\\repos\\PLVS\\.claude\\worktrees\\feature";
    expect(preferredWorktreePort(path)).toBe(preferredWorktreePort(path));
    expect(preferredWorktreePort(path.toUpperCase())).toBe(preferredWorktreePort(path));
  });

  it("stays inside the worktree range", () => {
    for (let index = 0; index < 200; index += 1) {
      const port = preferredWorktreePort(`/repos/plvs/.codex/worktrees/feature-${index}`);
      expect(port).toBeGreaterThanOrEqual(WORKTREE_PORTS.first);
      expect(port).toBeLessThanOrEqual(WORKTREE_PORTS.last);
    }
  });
});

describe("chooseWorktreePort", () => {
  const path = "/repos/plvs/.claude/worktrees/feature";

  it("takes the preferred port when it is free", async () => {
    expect(await chooseWorktreePort(path, async () => true)).toBe(preferredWorktreePort(path));
  });

  it("walks upward past bound ports and wraps inside the range", async () => {
    const preferred = preferredWorktreePort(path);
    const bound = new Set([
      preferred,
      preferred + 1 > WORKTREE_PORTS.last ? WORKTREE_PORTS.first : preferred + 1,
    ]);
    const chosen = await chooseWorktreePort(path, async (port) => !bound.has(port));
    expect(bound.has(chosen)).toBe(false);
    expect(chosen).toBeGreaterThanOrEqual(WORKTREE_PORTS.first);
    expect(chosen).toBeLessThanOrEqual(WORKTREE_PORTS.last);
  });

  it("fails when the whole range is taken", async () => {
    await expect(chooseWorktreePort(path, async () => false)).rejects.toThrow(
      /No free dev server port/
    );
  });
});

describe("portIsFree", () => {
  it("reports a port held by another listener as taken", async () => {
    const server = createServer();
    await new Promise((done) => server.listen({ port: 0, host: "127.0.0.1" }, done));
    const { port } = server.address();
    try {
      expect(await portIsFree(port)).toBe(false);
    } finally {
      await new Promise((done) => server.close(done));
    }
  });
});

describe("worktreeTauriConfig", () => {
  it("moves every localhost:1420 in the real devCsp and changes nothing else", () => {
    const base = readBaseTauriConfig();
    const overlay = worktreeTauriConfig(base, 1437);
    expect(overlay.build.devUrl).toBe("http://localhost:1437");
    expect(overlay.app.security.devCsp).not.toContain("localhost:1420");
    expect(overlay.app.security.devCsp.replaceAll("localhost:1437", "localhost:1420")).toBe(
      base.app.security.devCsp
    );
  });

  it("refuses a base config whose dev URL has moved", () => {
    expect(() => worktreeTauriConfig({ build: { devUrl: "http://localhost:5173" } }, 1437)).toThrow(
      /devUrl/
    );
  });
});

describe("worktreeTauriDevArgs", () => {
  const options = { configPath: "overlay.json", dataRoot: "/w/.dev-data" };

  it("adds the overlay and both separators when the caller passed none", () => {
    expect(worktreeTauriDevArgs(["--features", "dev-identity"], options)).toEqual([
      "--features",
      "dev-identity",
      "--config",
      "overlay.json",
      "--",
      "--",
      APP_DATA_ROOT_ARG,
      "/w/.dev-data",
    ]);
  });

  it("keeps the caller's cargo and app arguments in place", () => {
    expect(worktreeTauriDevArgs(["-v", "--", "--release", "--", "--flag"], options)).toEqual([
      "-v",
      "--config",
      "overlay.json",
      "--",
      "--release",
      "--",
      "--flag",
      APP_DATA_ROOT_ARG,
      "/w/.dev-data",
    ]);
  });

  it("leaves an explicit data root alone", () => {
    const args = ["--", "--", APP_DATA_ROOT_ARG, "/elsewhere"];
    expect(worktreeTauriDevArgs(args, options)).toEqual(["--config", "overlay.json", ...args]);
  });
});

describe("scopeDevCliToWorktree", () => {
  it("points the CLI at the worktree's data in a linked worktree", () => {
    const env = {};
    expect(scopeDevCliToWorktree(env, "/w")).toBe(worktreeCliIdentityRoot("/w"));
    expect(env.PLVS_TEST_IDENTITY_ROOT).toBe(worktreeCliIdentityRoot("/w"));
  });

  it("never overrides an explicit value", () => {
    const env = { PLVS_TEST_IDENTITY_ROOT: "/explicit" };
    expect(scopeDevCliToWorktree(env, "/w")).toBe("/explicit");
    expect(env.PLVS_TEST_IDENTITY_ROOT).toBe("/explicit");
  });

  it("leaves the main checkout untouched", () => {
    const env = {};
    expect(scopeDevCliToWorktree(env, null)).toBeNull();
    expect(env).toEqual({});
  });
});
