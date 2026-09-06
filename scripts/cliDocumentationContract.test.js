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

  it("publishes the complete Loudness Profile Control contract", () => {
    const cli = read("docs", "cli.md");
    const agentControl = read("docs", "agent-control", "README.md");
    const profiles = read("docs", "agent-control", "loudness-profiles.md");
    const libraries = read("docs", "agent-control", "libraries.md");
    const roadmap = read("docs", "working", "agent-control-cli-roadmap.md");

    for (const command of [
      "describe",
      "select",
      "create",
      "update",
      "rename",
      "delete",
      "reorder",
    ]) {
      expect(profiles).toContain(`loudness-profile ${command}`);
    }
    expect(profiles).toContain('"referenceLufs"');
    expect(profiles).toContain('"metricId"');
    expect(profiles).toContain("affectedPresetIds");
    expect(profiles).toContain("invalidProfile");
    expect(profiles).toContain("invalidPermutation");
    expect(profiles).toContain("editorActive");
    expect(cli).toContain("loudness-profile describe <id> --json");
    expect(agentControl).toContain("loudnessProfile.describe / loudnessProfile.select");
    expect(libraries).toContain("[Loudness Profile Control](loudness-profiles.md)");
    expect(roadmap).toContain("### Stage 2: Loudness Profile editing — complete");
    expect(roadmap).toContain("The next implementation stage is **Theme editing**");
  });
});
