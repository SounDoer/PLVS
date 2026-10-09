import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { agentControlSmokeChangesSinceLastTag } from "./agent-control-code-changed.mjs";

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function repository() {
  const cwd = mkdtempSync(join(tmpdir(), "plvs-agent-gate-"));
  directories.push(cwd);
  const git = (...args) => execFileSync("git", args, { cwd, stdio: "pipe" });
  git("init");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "src", "app.js"), "original");
  git("add", ".");
  git("commit", "-m", "initial");
  return { cwd, git };
}

it("requires desktop smoke without release history, ignores preview tags, and includes working changes", () => {
  const { cwd, git } = repository();
  expect(agentControlSmokeChangesSinceLastTag({ cwd })).toEqual({
    tag: null,
    paths: ["src/app.js"],
  });
  git("tag", "v1.0.0");
  expect(agentControlSmokeChangesSinceLastTag({ cwd }).paths).toEqual([]);
  writeFileSync(join(cwd, "src", "app.js"), "changed");
  expect(agentControlSmokeChangesSinceLastTag({ cwd }).paths).toEqual(["src/app.js"]);
  git("add", ".");
  git("commit", "-m", "change");
  git("tag", "preview-latest");
  expect(agentControlSmokeChangesSinceLastTag({ cwd })).toEqual({
    tag: "v1.0.0",
    paths: ["src/app.js"],
  });
});

it("skips documentation-only changes but includes untracked desktop sources", () => {
  const { cwd, git } = repository();
  git("tag", "v1.0.0");
  writeFileSync(join(cwd, "README.md"), "docs");
  expect(agentControlSmokeChangesSinceLastTag({ cwd }).paths).toEqual([]);
  writeFileSync(join(cwd, "src", "new.js"), "new");
  expect(agentControlSmokeChangesSinceLastTag({ cwd }).paths).toEqual(["src/new.js"]);
});

it("fails closed when Git cannot establish a comparison", () => {
  const cwd = mkdtempSync(join(tmpdir(), "plvs-agent-gate-invalid-"));
  directories.push(cwd);
  expect(() => agentControlSmokeChangesSinceLastTag({ cwd })).toThrow();
});
