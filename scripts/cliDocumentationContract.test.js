import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { describe, expect, it } from "vitest";

const read = (...parts) => readFileSync(join(cwd(), ...parts), "utf8");

describe("current CLI documentation", () => {
  it("describes opt-in PATH setup on public surfaces", () => {
    const readme = read("README.md");
    const landing = read("landing", "docs", "index.html");

    expect(readme).toContain("Enabling Agent Control in Settings");
    expect(landing).not.toContain("Installer builds add");
    expect(landing).toContain("Enabling Agent Control");
    expect(landing).toContain("plvs-cli.exe");
  });

  it("documents current development and release commands", () => {
    const contributing = read("CONTRIBUTING.md");
    const readme = read("README.md");
    const cli = read("docs", "cli.md");
    const agentControl = read("docs", "agent-control", "README.md");

    expect(contributing).not.toContain("release CLI 不显示 `app` 命令");
    expect(contributing).not.toContain("target/release/app.exe");
    expect(contributing).toContain("plvs.exe");
    expect(contributing).toContain("plvs-cli.exe");
    expect(contributing).toContain("Portable ZIP");
    for (const document of [contributing, readme, cli, agentControl]) {
      expect(document).not.toContain("plvs-cli app");
    }
    expect(readme).toContain("plvs-cli inspect --json");
    expect(cli).toContain("plvs-cli inspect --json");
    expect(cli).toContain("plvs-cli config export --json");
    expect(cli).toContain("plvs-cli config import <file|-> --expected-revision <n> --json");
    expect(readme).toContain("plvs-cli workspace apply");
    expect(agentControl).toContain("`methods`, and `features`");
  });

  it("uses current device discovery and harness validation guidance", () => {
    const agents = read("AGENTS.md");

    expect(agents).not.toContain("plvs-cli devices");
    expect(agents).toContain("device-enumeration");
    expect(agents).toContain("capture-harness");
    expect(agents).toContain("capture-smoke dependencies");
  });
});
