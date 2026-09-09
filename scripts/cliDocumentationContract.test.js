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
    expect(cli).toContain("plvs-cli schema list --json");
    expect(cli).toContain("plvs-cli schema get <command-id> --json");
    expect(cli).toContain("agent-control/generated/commands.md");
    expect(readme).toContain("plvs-cli workspace apply");
    expect(agentControl).toContain("`methods`, and `features`");
    expect(agentControl).toContain("generated/commands.md");
    expect(agentControl).toContain("`cliVersion`");
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
    const commands = read("docs", "agent-control", "generated", "commands.md");
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
    expect(commands).toContain("## `loudnessProfile.describe`");
    expect(commands).toContain("## `loudnessProfile.select`");
    expect(libraries).toContain("[Loudness Profile Control](loudness-profiles.md)");
    expect(roadmap).toContain("### Stage 2: Loudness Profile editing — complete");
  });

  it("publishes Theme Control as the only Agent Control owner of Appearance", () => {
    const cli = read("docs", "cli.md");
    const agentControl = read("docs", "agent-control", "README.md");
    const themes = read("docs", "agent-control", "themes.md");
    const settings = read("docs", "agent-control", "settings.md");
    const generatedSettings = read("docs", "agent-control", "generated", "settings.md");
    const libraries = read("docs", "agent-control", "libraries.md");
    const commands = read("docs", "agent-control", "generated", "commands.md");
    const roadmap = read("docs", "working", "agent-control-cli-roadmap.md");

    for (const command of [
      "inspect",
      "describe",
      "select",
      "follow-system",
      "create",
      "update",
      "rename",
      "duplicate",
      "delete",
      "reorder",
    ]) {
      expect(themes).toContain(`theme ${command}`);
    }
    expect(themes).toContain('"version": 2');
    expect(themes).toContain('"colorScheme"');
    expect(themes).toContain("themeNotMutable");
    expect(themes).toContain("themeNotExportable");
    expect(themes).toContain("invalidTheme");
    expect(themes).toContain("invalidPermutation");
    expect(themes).toContain("editorActive");
    expect(cli).toContain("theme follow-system --expected-revision <n> --json");
    expect(commands).toContain("## `theme.list`");
    expect(commands).toContain("## `theme.select`");
    expect(libraries).toContain("[Theme Control](themes.md)");
    expect(settings).toContain("`appearance` is an unknown control");
    expect(generatedSettings).not.toContain("appearance");
    expect(roadmap).toContain("### Stage 3: Theme editing — complete");
    expect(roadmap).toContain("generated shell completions");
    expect(roadmap).toContain("cross-platform desktop smoke automation are complete");
  });

  it("publishes the complete Device Control contract and safety flags", () => {
    const cli = read("docs", "cli.md");
    const agentControl = read("docs", "agent-control", "README.md");
    const devices = read("docs", "agent-control", "devices.md");
    const transport = read("docs", "agent-control", "transport.md");
    const commands = read("docs", "agent-control", "generated", "commands.md");
    const roadmap = read("docs", "working", "agent-control-cli-roadmap.md");

    for (const command of ["list", "inspect", "select"]) {
      expect(devices).toContain(`device ${command}`);
    }
    expect(devices).not.toContain("plvs-cli device describe");
    expect(devices).toContain("--expected-revision");
    expect(devices).toContain("--expected-generation");
    expect(devices).toContain("--allow-measurement-restart");
    expect(devices).toContain("--dry-run");
    expect(devices).toContain("automaticCurrentlyUnavailable");
    expect(devices).toContain("deviceInventoryChanged");
    expect(devices).toContain("deviceStartFailed");
    expect(devices).toContain("stateCommitted: true");
    expect(cli).toContain("device list --json");
    expect(cli).toContain(
      "device select <device-id|default> --expected-revision <n> --expected-generation <n>"
    );
    expect(commands).toContain("## `device.list`");
    expect(commands).toContain("## `device.select`");
    expect(transport).toContain("[Device Control](devices.md)");
    expect(transport).toContain("device-enumeration");
    expect(roadmap).toContain("### Stage 4: Device Control — complete");
    expect(roadmap).not.toContain("plvs-cli device describe");
    expect(roadmap).toContain("generated shell completions");
    expect(roadmap).toContain("cross-platform desktop smoke automation are complete");
  });

  it("publishes the complete Visual Capture contract and bounded media rules", () => {
    const cli = read("docs", "cli.md");
    const agentControl = read("docs", "agent-control", "README.md");
    const visual = read("docs", "agent-control", "visual.md");
    const commands = read("docs", "agent-control", "generated", "commands.md");
    const roadmap = read("docs", "working", "agent-control-cli-roadmap.md");
    const implementationPlan = read(
      "docs",
      "superpowers",
      "plans",
      "2026-09-07-agent-control-visual-capture-implementation.md"
    );

    for (const command of [
      "visual describe",
      "visual screenshot",
      "visual recording start",
      "visual recording inspect",
      "visual recording wait",
      "visual recording stop",
    ]) {
      expect(cli).toContain(command);
      expect(visual).toContain(command);
    }
    expect(visual).toContain("actual rendered pixels");
    expect(visual).toContain("--expected-revision");
    expect(visual).toContain("--audio <none|measured-source>");
    expect(visual).toContain("--cursor <none|visible>");
    expect(visual).toContain("system pointer is excluded by default");
    expect(visual).toContain("Live defaults");
    expect(visual).toContain("File defaults");
    expect(visual).toContain("2 GiB");
    expect(visual).toContain("30 minutes");
    expect(visual).toContain("24-hour");
    expect(visual).toContain("4 GiB");
    expect(visual).toContain("Both platforms support either no audio");
    expect(visual).toContain("does not enable ScreenCaptureKit system-audio capture");
    expect(visual).toContain("Screen & System Audio Recording");
    expect(visual).toContain("File decoder PCM is never recorded");
    expect(commands).toContain("## `visual.recording.start`");
    expect(commands).toContain("## `visual.recording.inspect`");
    expect(roadmap).toContain("### Stage 5: Visual Capture — complete");
    expect(roadmap).not.toContain("**Measurement inspect/wait** after");
    expect(roadmap).not.toContain("MCP, screenshots, and window control");
    expect(implementationPlan).toContain("Implementation status (2026-09-08)");
    expect(implementationPlan).toContain("Delivered across Phases A-D");
  });
});
