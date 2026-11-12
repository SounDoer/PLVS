import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(cwd(), ".github", "workflows", "ci.yml"), "utf8");
const workflow = parse(source);
const packageWorkflow = parse(
  readFileSync(join(cwd(), ".github", "workflows", "package-check.yml"), "utf8")
);

function commands(job) {
  return (job.steps ?? [])
    .map((step) => step.run)
    .filter(Boolean)
    .join("\n");
}

describe("ordinary CI lanes", () => {
  it("runs push and pull request CI on main", () => {
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(workflow.on.pull_request).toEqual({ branches: ["main"] });
  });

  it("cancels superseded work and exports every classifier lane", () => {
    expect(workflow.concurrency).toEqual({
      group: "ci-${{ github.workflow }}-${{ github.ref }}",
      "cancel-in-progress": true,
    });
    expect(workflow.jobs.scope.outputs).toEqual({
      scope: "${{ steps.changes.outputs.scope }}",
      contracts: "${{ steps.changes.outputs.contracts }}",
      frontend: "${{ steps.changes.outputs.frontend }}",
      native: "${{ steps.changes.outputs.native }}",
      package_windows: "${{ steps.changes.outputs.package_windows }}",
      package_macos: "${{ steps.changes.outputs.package_macos }}",
      package_linux: "${{ steps.changes.outputs.package_linux }}",
    });
  });

  it("puts the cheap license gate ahead of every expensive lane", () => {
    expect(workflow.jobs.licenses.needs).toBe("scope");
    expect(workflow.jobs.licenses.if).toBeUndefined();
    for (const name of [
      "contracts",
      "frontend",
      "rust",
      "rust-windows",
      "rust-macos",
      "package-check",
    ]) {
      expect(workflow.jobs[name].needs, name).toEqual(["scope", "licenses"]);
    }
    expect(workflow.jobs.contracts.if).toBe("needs.scope.outputs.contracts == 'true'");
    expect(workflow.jobs.frontend.if).toBe("needs.scope.outputs.frontend == 'true'");
    for (const name of ["rust", "rust-windows", "rust-macos"]) {
      expect(workflow.jobs[name].if).toBe("needs.scope.outputs.native == 'true'");
    }
    expect(workflow.jobs["package-check"].uses).toBe("./.github/workflows/package-check.yml");
    expect(workflow.jobs["package-check"].with).toEqual({
      windows: "${{ needs.scope.outputs.package_windows == 'true' }}",
      macos: "${{ needs.scope.outputs.package_macos == 'true' }}",
      linux: "${{ needs.scope.outputs.package_linux == 'true' }}",
    });
  });

  it("checks product publication inputs in the contracts lane", () => {
    expect(commands(workflow.jobs.contracts)).toContain("node scripts/privacy-review.mjs check");
    expect(commands(workflow.jobs.contracts)).toContain("npm run sharesets:source:check");
    expect(workflow.jobs.website).toBeUndefined();
  });

  it("uses the reviewed decoder sidecar for tests without an apt FFmpeg download", () => {
    const contractCommands = commands(workflow.jobs.contracts);
    expect(contractCommands).toContain("npm run ffmpeg:fetch");
    expect(contractCommands).toContain("npm test");
    expect(contractCommands).toContain("npm run test:coverage");
    expect(workflow.jobs.contracts.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          env: {
            PLVS_FFMPEG:
              "${{ github.workspace }}/src-tauri/binaries/ffmpeg-x86_64-unknown-linux-gnu",
          },
        }),
      ])
    );
    expect(source).not.toContain("name: Install ffmpeg");
  });

  it("runs platform-independent Rust formatting once and bounds network work", () => {
    expect(commands(workflow.jobs.rust)).toContain("cargo fmt --all -- --check");
    expect(commands(workflow.jobs["rust-windows"])).not.toContain("cargo fmt");
    expect(commands(workflow.jobs["rust-macos"])).not.toContain("cargo fmt");
    expect(commands(workflow.jobs.rust)).toContain("Acquire::Retries=3");
    expect(workflow.jobs.rust["timeout-minutes"]).toBe(35);
    expect(workflow.jobs["rust-windows"]["timeout-minutes"]).toBe(30);
    expect(workflow.jobs["rust-macos"]["timeout-minutes"]).toBe(30);
  });

  it("bypasses the slow Azure mirror before bounded Linux dependency installs", () => {
    for (const job of [workflow.jobs.rust, packageWorkflow.jobs.linux]) {
      const install = job.steps.find((step) => step.run?.includes("sudo apt-get"));
      expect(install["timeout-minutes"]).toBe(10);
      expect(install.run).toContain(
        "sudo sed -i '/azure\\.archive\\.ubuntu\\.com/d' /etc/apt/apt-mirrors.txt"
      );
      expect(install.run.indexOf("sudo sed")).toBeLessThan(install.run.indexOf("sudo apt-get"));
      expect(install.run).toContain("Acquire::Retries=3");
    }
  });
});
