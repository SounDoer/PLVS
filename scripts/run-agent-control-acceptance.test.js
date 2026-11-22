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

  it("distinguishes a native Wayland skip from a successful visible recording", () => {
    const window = {
      backend: "wayland",
      recording: "passed",
      minimizedScreenshot: "unsupported",
      minimizedRecording: "unsupported",
      localDisplayName: "private display",
    };
    expect(
      summarizeScenario(
        "window-platform-contract",
        sourceSha,
        0,
        { ...trace, scenario: "window-platform-contract", window },
        null
      ).window
    ).toEqual({
      backend: "wayland",
      recording: "passed",
      minimizedScreenshot: "unsupported",
      minimizedRecording: "unsupported",
    });
  });

  it("projects only command IDs, codes and counts around a failure before cleanup", () => {
    const failed = {
      ...trace,
      scenario: "window-platform-contract",
      status: "failed",
      steps: ["private context"],
      failure: { cliCount: 2, code: "ERR_ASSERTION" },
      cli: [
        {
          args: ["instances"],
          status: 0,
          response: { result: { instances: [{ instanceId: "private-id" }] } },
        },
        {
          args: ["--instance", "private-id", "window", "move", "--monitor", "private-name"],
          status: 4,
          response: { error: { code: "uiNotSettled", message: "/private/profile" } },
        },
        {
          args: ["workbench", "quit-all"],
          status: 0,
          response: { result: {} },
        },
      ],
    };
    expect(summarizeScenario(failed.scenario, sourceSha, 1, failed, null).diagnostic).toEqual({
      completedSteps: 1,
      code: "ERR_ASSERTION",
      commandHistory: [
        { command: "instances.list", exitCode: 0, instanceCount: 1 },
        { command: "window.move", exitCode: 4, code: "uiNotSettled" },
      ],
    });
  });
});
