import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(cwd(), ".github", "workflows", "package-check.yml"), "utf8");
const workflow = parse(source);
const packageJson = JSON.parse(readFileSync(join(cwd(), "package.json"), "utf8"));
const macVerifier = readFileSync(join(cwd(), "scripts", "verify-macos-dmg.sh"), "utf8");

function commands(job) {
  return (job.steps ?? [])
    .map((step) => step.run)
    .filter(Boolean)
    .join("\n");
}

describe("routine package checks", () => {
  it("is reusable, manually selectable and periodically runs the complete matrix", () => {
    expect(workflow.on.workflow_call.inputs).toEqual({
      windows: { type: "boolean", default: false },
      macos: { type: "boolean", default: false },
      linux: { type: "boolean", default: false },
    });
    expect(workflow.on.workflow_dispatch.inputs.platform.options).toEqual([
      "all",
      "windows",
      "macos",
      "linux",
    ]);
    expect(workflow.on.schedule).toHaveLength(1);
    expect(source).not.toContain("secrets.");
  });

  it("checks equivalent installable candidates on all three hosted platforms", () => {
    expect(Object.keys(workflow.jobs)).toEqual(["windows", "macos", "linux"]);
    expect(workflow.jobs.windows["runs-on"]).toBe("windows-2025-vs2026");
    expect(workflow.jobs.macos["runs-on"]).toBe("macos-26");
    expect(workflow.jobs.linux["runs-on"]).toBe("ubuntu-24.04");
    for (const name of ["windows", "macos", "linux"]) {
      expect(workflow.jobs[name]["timeout-minutes"], name).toBeGreaterThanOrEqual(40);
      expect(workflow.jobs[name].if, name).toContain(`inputs.${name}`);
      expect(workflow.jobs[name].if, name).toContain("github.event_name == 'schedule'");
      expect(workflow.jobs[name].if, name).not.toContain("github.event_name == 'workflow_call'");
      expect(commands(workflow.jobs[name]), name).toContain("npm ci");
      expect(source, name).toContain(`name: package-check-${name}`);
    }
    expect(commands(workflow.jobs.windows)).toContain("npm run desktop:check-nsis");
    expect(commands(workflow.jobs.windows)).toContain("npm run desktop:verify-stable-nsis");
    expect(commands(workflow.jobs.macos)).toContain("npm run desktop:check-dmg");
    expect(commands(workflow.jobs.macos)).toContain("npm run desktop:verify-check-dmg");
    expect(commands(workflow.jobs.linux)).toContain("npm run desktop:stable-deb");
    expect(commands(workflow.jobs.linux)).toContain("verify-linux-deb-clean.sh");
    expect(commands(workflow.jobs.linux)).toMatch(/install -y[\s\S]*\bffmpeg\b/);
    expect(commands(workflow.jobs.linux)).toMatch(
      /generate-sidecar-fixtures\.mjs[\s\\]*"\$PWD\/linux-sidecar-fixtures"[\s\\]*\/usr\/bin\/ffmpeg/
    );
  });

  it("keeps routine macOS unsigned while leaving exact-release verification strict", () => {
    for (const script of ["desktop:check-nsis", "desktop:check-dmg"]) {
      expect(packageJson.scripts[script]).toContain("tauri.no-updater.conf.json");
    }
    expect(packageJson.scripts["desktop:verify-check-dmg"]).toContain("stable routine");
    expect(macVerifier).toContain('if [[ "$verification" == release ]]');
    expect(macVerifier).toContain('xcrun stapler validate "$updater_app"');
    expect(packageJson.scripts["desktop:verify-stable-dmg"]).toBe(
      "bash scripts/verify-macos-dmg.sh"
    );
  });
});
