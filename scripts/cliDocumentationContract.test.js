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

    expect(contributing).not.toContain("release CLI 不显示 `app` 命令");
    expect(contributing).not.toContain("target/release/app.exe");
    expect(contributing).toContain("plvs.exe");
    expect(contributing).toContain("plvs-cli.exe");
    expect(contributing).toContain("Portable ZIP");
  });

  it("uses current device discovery and harness validation guidance", () => {
    const agents = read("AGENTS.md");

    expect(agents).not.toContain("plvs-cli devices");
    expect(agents).toContain("device-enumeration");
    expect(agents).toContain("capture-harness");
    expect(agents).toContain("capture-smoke dependencies");
  });
});
