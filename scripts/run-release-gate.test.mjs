import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("run-release-gate", () => {
  it("leaves real capture smoke to the remote three-platform capture acceptance", () => {
    const gate = readFileSync(new URL("./run-release-gate.mjs", import.meta.url), "utf8");
    const release = readFileSync(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8"
    );
    expect(gate).not.toContain("smoke:capture");
    expect(release).toContain("uses: ./.github/workflows/capture-acceptance.yml");
  });

  it("leaves the desktop Agent Control smoke to the remote release-package smoke", () => {
    const gate = readFileSync(new URL("./run-release-gate.mjs", import.meta.url), "utf8");
    const release = readFileSync(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8"
    );
    expect(gate).not.toContain("smoke:agent-control");
    expect(release).toContain("uses: ./.github/workflows/release-package-smoke.yml");
  });
});
