import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("run-release-gate", () => {
  it("builds the capture harness immediately before release capture smoke", () => {
    const gate = readFileSync(new URL("./run-release-gate.mjs", import.meta.url), "utf8");
    const buildCall = 'run("Capture harness build", BUILD_HARNESS, []);';
    const build = gate.indexOf(buildCall);
    const smoke = gate.indexOf('run("Capture smoke", npm, ["run", "smoke:capture"]);');
    expect(gate).toContain('import { BUILD_HARNESS } from "./capture-rig.mjs";');
    expect(build).toBeGreaterThan(-1);
    expect(smoke).toBeGreaterThan(build);
    expect(gate.slice(build + buildCall.length, smoke)).not.toContain("run(");
  });
});
