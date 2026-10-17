import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  acceptanceBootstrapMarker,
  comparableDock,
  findUpdateSurface,
  hasFeedPackageRequest,
  macAcceptanceLaunch,
  parseRunArguments,
  windowsAcceptanceInstall,
  windowsAcceptanceLaunch,
} from "./run-update-acceptance.mjs";

describe("update acceptance runner", () => {
  it("launches the exact macOS bundle executable with isolated data", () => {
    expect(
      macAcceptanceLaunch("/tmp/install with spaces/Test.app", "/tmp/data with spaces")
    ).toEqual({
      command: "/tmp/install with spaces/Test.app/Contents/MacOS/plvs",
      args: [
        "-ApplePersistenceIgnoreState",
        "YES",
        "--plvs-test-app-data-root",
        "/tmp/data with spaces",
      ],
    });
    expect(acceptanceBootstrapMarker("/tmp/data with spaces")).toBe(
      "/tmp/data with spaces/multi-instance/migration-complete.json"
    );
  });

  it("rejects unsafe run IDs", () => {
    expect(() => parseRunArguments(["/tmp/root", "--run-id", "../outside"])).toThrow(/Usage/);
  });

  it("keeps Windows NSIS and launch paths with spaces as single arguments", () => {
    expect(
      windowsAcceptanceInstall("C:\\build\\test setup.exe", "C:\\runs\\Installed App With Spaces")
    ).toEqual({
      command: "C:\\build\\test setup.exe",
      args: ["/S", "/D=C:\\runs\\Installed App With Spaces"],
    });
    expect(
      windowsAcceptanceLaunch(
        "C:\\runs\\Installed App With Spaces\\plvs.exe",
        "C:\\data with spaces"
      )
    ).toEqual({
      command: "C:\\runs\\Installed App With Spaces\\plvs.exe",
      args: ["--plvs-test-app-data-root", "C:\\data with spaces"],
    });
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

  it("distinguishes package fault requests and real update error surfaces", () => {
    expect(
      hasFeedPackageRequest(
        [
          { path: "/latest.json", fault: "stale-signature" },
          { path: "/package.app.tar.gz", fault: "stale-signature" },
        ],
        "stale-signature",
        "/package.app.tar.gz"
      )
    ).toBe(true);
    expect(
      hasFeedPackageRequest(
        [{ path: "/package.app.tar.gz", fault: "valid" }],
        "truncated-package",
        "/package.app.tar.gz"
      )
    ).toBe(false);
    expect(
      findUpdateSurface({
        surfaces: [
          { surfaceId: "setup", kind: "update", target: { phase: "preferences" } },
          { surfaceId: "failure", kind: "update", target: { phase: "idle" } },
        ],
      })
    ).toMatchObject({ surfaceId: "failure" });
  });

  it("publishes one command family for both platform adapters", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts;
    expect(scripts).toMatchObject({
      "update:acceptance:build": "node scripts/build-update-acceptance.mjs",
      "update:acceptance:serve": "node scripts/serve-update-acceptance.mjs",
      "update:acceptance:run": "node scripts/run-update-acceptance.mjs",
      "update:acceptance:verify": "node scripts/verify-update-acceptance.mjs",
    });
  });
});
