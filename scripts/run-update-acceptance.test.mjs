import { normalize, resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  acceptanceBootstrapMarker,
  comparableDock,
  findUpdateSurface,
  hasFeedPackageRequest,
  helperPauseMarker,
  macAcceptanceLaunch,
  macReadOnlyDmgLayout,
  mountReportsReadOnly,
  parseRunArguments,
  seedAcceptanceSettings,
  windowsAcceptanceInstall,
  windowsAcceptanceLaunch,
} from "./run-update-acceptance.mjs";

describe("update acceptance runner", () => {
  it("launches the exact macOS bundle executable with isolated data", () => {
    expect(
      macAcceptanceLaunch("/tmp/install with spaces/Test.app", "/tmp/data with spaces")
    ).toEqual({
      command: normalize("/tmp/install with spaces/Test.app/Contents/MacOS/plvs"),
      args: [
        "-ApplePersistenceIgnoreState",
        "YES",
        "--plvs-test-app-data-root",
        "/tmp/data with spaces",
      ],
    });
    expect(acceptanceBootstrapMarker("/tmp/data with spaces")).toBe(
      normalize("/tmp/data with spaces/multi-instance/migration-complete.json")
    );
  });

  it("derives isolated read-only DMG paths without losing spaces", () => {
    expect(
      macReadOnlyDmgLayout("/tmp/artifacts", "/tmp/run with spaces", {
        productName: "PLVS Update Test abc12345",
        versions: [{ dmg: "packages/older image.dmg" }],
      })
    ).toEqual({
      dmg: resolve("/tmp/artifacts/packages/older image.dmg"),
      mountRoot: normalize("/tmp/run with spaces/read-only dmg"),
      dataRoot: normalize("/tmp/run with spaces/read-only dmg data"),
      app: normalize("/tmp/run with spaces/read-only dmg/PLVS Update Test abc12345.app"),
    });
  });

  it("keeps the helper pause marker beside the recorded attempt", () => {
    expect(helperPauseMarker("/tmp/data with spaces/updates/pkg/attempt.json")).toBe(
      normalize("/tmp/data with spaces/updates/pkg/acceptance-helper-paused")
    );
  });

  it("requires the exact DMG mount point to report read-only", () => {
    const output = [
      "/dev/disk3s1 on /Volumes/Other (apfs, local, read-only)",
      "/dev/disk4s1 on /tmp/run with spaces/read-only dmg (hfs, local, read-only, noowners)",
    ].join("\n");
    expect(mountReportsReadOnly(output, "/tmp/run with spaces/read-only dmg")).toBe(true);
    expect(mountReportsReadOnly(output, "/Volumes/Other writable")).toBe(false);
    expect(
      mountReportsReadOnly(
        "/dev/disk4s1 on /tmp/run with spaces/read-only dmg (hfs, local, noowners)",
        "/tmp/run with spaces/read-only dmg"
      )
    ).toBe(false);
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
      options: { windowsVerbatimArguments: true },
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

  it("seeds a non-blocking close behavior for guided restarts and cleanup", () => {
    const root = mkdtempSync(resolve(tmpdir(), "plvs-update-acceptance-"));
    try {
      seedAcceptanceSettings(root, true);
      expect(JSON.parse(readFileSync(resolve(root, "plvs-settings.json"), "utf8"))).toMatchObject({
        agentControlEnabled: true,
        closeBehavior: "quit",
        dockState: { enabled: true },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
