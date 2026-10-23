import { describe, expect, it } from "vitest";
import { commandPlanForPaths } from "./pre-commit.mjs";

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
        { command: "/node", args: ["node_modules/lint-staged/bin/lint-staged.js"] },
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
});
