import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { commandPlanForPaths, runPreCommit } from "./pre-commit.mjs";

describe("pre-commit command selection", () => {
  it("does no repository-wide work for unrelated staged files", () => {
    expect(commandPlanForPaths(["licenses/upstream/notice.txt"])).toEqual([]);
  });

  it("formats only supported staged source and documentation paths", () => {
    for (const file of [
      "src/App.jsx",
      "scripts/check-changes.mjs",
      ".github/workflows/ci.yml",
      "docs/architecture.md",
      ".agents/skills/plvs-release/SKILL.md",
      "CONTRIBUTING.md",
      "package.json",
    ]) {
      expect(commandPlanForPaths([file], { nodeExecutable: "/node" })).toEqual([
        {
          command: "/node",
          args: ["node_modules/lint-staged/bin/lint-staged.js", "--hide-unstaged"],
        },
      ]);
    }
  });

  it("runs Rust formatting only for staged Rust source", () => {
    expect(commandPlanForPaths(["src-tauri/src/doctor.rs"])).toEqual([
      {
        command: "cargo",
        args: ["fmt", "--manifest-path", "src-tauri/Cargo.toml", "--all", "--", "--check"],
      },
    ]);
  });

  it("checks Cargo lock consistency without changing the lockfile", () => {
    const [command] = commandPlanForPaths(["src-tauri/plvs-cli/Cargo.toml"]);
    expect(command.command).toBe("cargo");
    expect(command.args).toContain("metadata");
    expect(command.args).toContain("--locked");
    expect(command.args).not.toContain("update");
  });

  it("deduplicates commands for a mixed staged change", () => {
    const plan = commandPlanForPaths(
      ["src/App.jsx", "scripts/a.mjs", "src-tauri/src/lib.rs", "src-tauri/Cargo.toml"],
      { nodeExecutable: "/node" }
    );
    expect(plan.map(({ command, args }) => `${command} ${args[0]}`)).toEqual([
      "/node node_modules/lint-staged/bin/lint-staged.js",
      "cargo fmt",
      "cargo metadata",
    ]);
  });

  it("formats the index while preserving partially and fully unstaged edits", () => {
    const cwd = mkdtempSync(join(tmpdir(), "plvs-pre-commit-"));
    const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
    try {
      git("init", "--quiet");
      git("config", "user.name", "PLVS Test");
      git("config", "user.email", "test@example.invalid");
      git("config", "commit.gpgsign", "false");
      git("config", "core.hooksPath", join(cwd, "no-hooks"));
      mkdirSync(join(cwd, "scripts"));
      const partial = join(cwd, "scripts/partial.js");
      const unstaged = join(cwd, "scripts/unstaged.js");
      const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
      writeFileSync(
        join(cwd, "package.json"),
        JSON.stringify({
          private: true,
          "lint-staged": {
            "scripts/*.js": `${quote(process.execPath)} ${quote(resolve("node_modules/prettier/bin/prettier.cjs"))} --write`,
          },
        })
      );
      // Mirror the repository's line-ending rule; without it a machine with core.autocrlf=true
      // gets CRLF back when lint-staged restores the unstaged edits.
      writeFileSync(join(cwd, ".gitattributes"), "* text=auto eol=lf\n");
      writeFileSync(partial, "const staged = 0;\n\nconst draft = 0;\n");
      writeFileSync(unstaged, "const unrelated = 0;\n");
      git("add", ".");
      git("commit", "--quiet", "-m", "fixture");
      symlinkSync(
        resolve("node_modules"),
        join(cwd, "node_modules"),
        process.platform === "win32" ? "junction" : "dir"
      );
      writeFileSync(partial, "const staged=1;\n\nconst draft = 0;\n");
      git("add", "scripts/partial.js");
      writeFileSync(partial, "const staged=1;\n\nconst draft = 2;\n");
      writeFileSync(unstaged, "const unrelated=7;\n");

      runPreCommit({ cwd });

      expect(git("show", ":scripts/partial.js")).toBe("const staged = 1;\n\nconst draft = 0;\n");
      expect(readFileSync(partial, "utf8")).toBe("const staged = 1;\n\nconst draft = 2;\n");
      expect(git("show", ":scripts/unstaged.js")).toBe("const unrelated = 0;\n");
      expect(readFileSync(unstaged, "utf8")).toBe("const unrelated=7;\n");
      expect(git("diff", "--cached", "--name-only").trim()).toBe("scripts/partial.js");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
