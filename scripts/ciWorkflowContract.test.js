import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(cwd(), ".github", "workflows", "ci.yml"), "utf8");
const workflow = parse(source);

function commands(job) {
  return (job.steps ?? [])
    .map((step) => step.run)
    .filter(Boolean)
    .join("\n");
}

describe("ordinary CI lanes", () => {
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
});
