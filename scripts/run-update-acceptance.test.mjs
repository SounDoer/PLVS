import { describe, expect, it } from "vitest";

import {
  comparableDock,
  macAcceptanceLaunch,
  parseRunArguments,
} from "./run-update-acceptance.mjs";

describe("update acceptance runner", () => {
  it("preserves paths with spaces as individual LaunchServices arguments", () => {
    expect(
      macAcceptanceLaunch("/tmp/install with spaces/Test.app", "/tmp/data with spaces")
    ).toEqual({
      command: "open",
      args: [
        "-n",
        "-a",
        "/tmp/install with spaces/Test.app",
        "--args",
        "--plvs-test-app-data-root",
        "/tmp/data with spaces",
      ],
    });
  });

  it("rejects unsafe run IDs", () => {
    expect(() => parseRunArguments(["/tmp/root", "--run-id", "../outside"])).toThrow(/Usage/);
  });

  it("compares durable Dock state without monitor or runtime analysis fields", () => {
    expect(
      comparableDock({
        enabled: true,
        edge: "bottom",
        height: 160,
        reserveSpace: false,
        monitor: "Monitor #1",
        panels: [
          {
            id: "level",
            moduleId: "levelMeter",
            width: 150,
            widthMode: "preferred",
            controls: {},
            analysis: { status: "active" },
          },
        ],
      })
    ).toEqual({
      enabled: true,
      edge: "bottom",
      height: 160,
      reserveSpace: false,
      panels: [
        { id: "level", moduleId: "levelMeter", width: 150, widthMode: "preferred", controls: {} },
      ],
    });
  });
});
