import { describe, expect, it } from "vitest";
import { summarizeScenario } from "./run-agent-control-acceptance.mjs";

const sourceSha = "a".repeat(40);
const trace = {
  scenario: "desktop",
  head: sourceSha,
  workingTreeDirty: false,
  status: "passed",
  cli: [{ file: "/private/profile", device: "test device" }],
};
const desktop = {
  sourceSha,
  summary: "complete",
  scenarios: [{ id: "base-smoke", status: "passed", observations: ["/private/profile"] }],
};

describe("Agent Control workflow summary", () => {
  it("keeps only structured check status from the local evidence", () => {
    expect(summarizeScenario("desktop", sourceSha, 0, trace, desktop)).toEqual({
      id: "desktop",
      status: "passed",
      exitCode: 0,
      checks: [{ id: "base-smoke", status: "passed" }],
    });
  });

  it("requires clean, matching evidence and a successful command", () => {
    expect(summarizeScenario("desktop", sourceSha, 1, trace, desktop).status).toBe("failed");
    expect(
      summarizeScenario("desktop", sourceSha, 0, { ...trace, workingTreeDirty: true }, desktop)
        .status
    ).toBe("failed");
    expect(summarizeScenario("desktop", sourceSha, 0, trace, null).status).toBe("failed");
    expect(
      summarizeScenario("desktop", sourceSha, 0, trace, { ...desktop, sourceSha: "b".repeat(40) })
        .status
    ).toBe("failed");
    expect(
      summarizeScenario(
        "window-platform-contract",
        sourceSha,
        0,
        {
          ...trace,
          scenario: "window-platform-contract",
        },
        null
      ).status
    ).toBe("passed");
  });
});
