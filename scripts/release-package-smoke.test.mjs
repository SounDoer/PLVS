import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_CONTROL_SCENARIOS,
  REQUIRED_SCENARIOS,
  candidatePackage,
  expectedTone,
  isolatedProfileSeed,
  judgeTone,
  keepDisplayAwake,
  launchCommand,
  installedPackageNames,
  missingDebDependencies,
  parseArgs,
  selectRigDevice,
  stagedLayout,
} from "./release-package-smoke.mjs";
import { verifyReleasePackageEvidence } from "./verify-release-package-evidence.mjs";
import { retryUnsettledRenderOnce } from "./smoke-agent-control.mjs";

const SHA = "a".repeat(40);

function measurement({ integrated = -22.04, peaks = [-20, -26], state = "running" } = {}) {
  return {
    source: { state },
    sample: { freshness: state === "running" ? "fresh" : "stale" },
    loudness: { integratedLufs: integrated },
    levels: { channels: peaks.map((peakDbfs) => ({ peakDbfs })) },
  };
}

describe("release-package smoke", () => {
  it("covers every base Agent Control smoke scenario plus the package and capture checks", () => {
    expect(REQUIRED_SCENARIOS).toEqual(expect.arrayContaining(AGENT_CONTROL_SCENARIOS));
    expect(REQUIRED_SCENARIOS).toEqual(
      expect.arrayContaining(["package-staging", "isolated-launch", "live-capture-signal"])
    );
  });

  it("requires a candidate directory", () => {
    expect(() => parseArgs([])).toThrow(/Usage/);
    expect(parseArgs(["--candidate", "c", "--wait"])).toMatchObject({ wait: true });
  });

  it("tests the asset names users download", () => {
    const root = mkdtempSync(join(tmpdir(), "plvs-candidate-"));
    mkdirSync(join(root, "release-assets"));
    for (const name of [
      "PLVS-v1.2.3-x64-portable.zip",
      "PLVS-v1.2.3-aarch64.dmg",
      "PLVS_1.2.3_amd64.deb",
    ]) {
      writeFileSync(join(root, "release-assets", name), "x");
    }
    expect(candidatePackage("windows", root, "1.2.3")).toMatch(/portable\.zip$/);
    expect(candidatePackage("macos", root, "1.2.3")).toMatch(/aarch64\.dmg$/);
    expect(candidatePackage("linux", root, "1.2.3")).toMatch(/amd64\.deb$/);
    expect(() => candidatePackage("windows", root, "9.9.9")).toThrow(/missing/);
  });

  it("enables Agent Control only in the isolated seed and skips every first-run prompt", () => {
    expect(isolatedProfileSeed()).toEqual({
      agentControlEnabled: true,
      "plvs:settings": {
        closeAction: "quit",
        updatePreferences: { choiceMade: true, autoCheck: false, autoDownload: false },
      },
    });
  });

  it("starts every platform on the isolated data root and moves its WebView data", () => {
    const isolation = { dataRoot: "/w/data", webviewRoot: "/w/webview" };
    for (const platform of ["windows", "macos", "linux"]) {
      const launch = launchCommand(platform, stagedLayout(platform, "/w/package"), isolation);
      expect(launch.args.slice(-2)).toEqual(["--plvs-test-app-data-root", "/w/data"]);
    }
    expect(launchCommand("windows", stagedLayout("windows", "/w/p"), isolation).env).toEqual({
      WEBVIEW2_USER_DATA_FOLDER: "/w/webview",
    });
    const linux = launchCommand("linux", stagedLayout("linux", "/w/p"), isolation).env;
    expect(linux.XDG_DATA_HOME).toContain("webview");
    expect(linux.XDG_RUNTIME_DIR).toBeUndefined();
    expect(linux.PLVS_FFMPEG_DIR).toBe(join("/w/p", "usr", "lib", "plvs", "sidecars"));
    expect(launchCommand("macos", stagedLayout("macos", "/w/p"), isolation).args[0]).toBe(
      "-ApplePersistenceIgnoreState"
    );
  });

  it("selects exactly one rig device per platform", () => {
    const devices = [
      { id: "lb-1", label: "CABLE Input", kind: "systemOutput", direction: "output" },
      {
        id: "cap-1",
        label: "CABLE Output (VB-Audio Virtual Cable)",
        kind: "input",
        direction: "input",
      },
      { id: "lb-2", label: "plvs_rig_42", kind: "systemOutput", direction: "output" },
    ];
    expect(selectRigDevice("windows", devices).id).toBe("cap-1");
    expect(selectRigDevice("linux", devices, { linuxSinkName: "plvs_rig_42" }).id).toBe("lb-2");
    expect(() => selectRigDevice("linux", devices, { linuxSinkName: "plvs_rig_7" })).toThrow(
      /exactly one/
    );
    const blackHole = {
      id: `lb-${"0".repeat(32)}`,
      label: "BlackHole 2ch",
      kind: "systemOutput",
      sampleRateHz: 48000,
      channelCount: 2,
    };
    expect(selectRigDevice("macos", [blackHole]).id).toBe(blackHole.id);
  });

  it("expects the rig tone's summed-channel loudness and per-channel peaks", () => {
    const tone = expectedTone({ peakLDb: -20, peakRDb: -26 });
    expect(tone.integratedLufs).toBeCloseTo(-22.04, 2);
    expect(tone.peakDbfs).toEqual([-20, -26]);
  });

  it("fails null, swapped, quiet or stale readings rather than skipping them", () => {
    expect(judgeTone(measurement())).toEqual([]);
    expect(judgeTone(measurement({ integrated: null })).join()).toMatch(
      /integrated loudness is null/
    );
    expect(judgeTone(measurement({ peaks: [-26, -20] }))).toHaveLength(2);
    expect(judgeTone(measurement({ integrated: -28 })).join()).toMatch(/expected -22\.04/);
    expect(judgeTone(measurement({ state: "stopped" })).join()).toMatch(/not running/);
  });

  it("names each unmet deb dependency group", () => {
    const installed = (name) => ["libc6", "libappindicator3-1"].includes(name);
    expect(
      missingDebDependencies(
        "libc6 (>= 2.35), libgtk-3-0, libayatana-appindicator3-1 | libappindicator3-1",
        installed
      )
    ).toEqual(["libgtk-3-0"]);
  });

  it("counts the old library names that Ubuntu 24.04's t64 packages provide", () => {
    const names = installedPackageNames(
      [
        "install ok installed\tlibgtk-3-0t64\tlibgtk-3-0 (= 3.24.41-4ubuntu1.3)",
        "install ok installed\tlibc6\t",
        "deinstall ok config-files\tlibold\tliblegacy",
        "",
      ].join("\n")
    );
    expect([...names].sort()).toEqual(["libc6", "libgtk-3-0", "libgtk-3-0t64"]);
    expect(
      missingDebDependencies("libc6 (>= 2.39), libgtk-3-0t64, libgtk-3-0, liblegacy", (name) =>
        names.has(name)
      )
    ).toEqual(["liblegacy"]);
  });
});

describe("release-package evidence", () => {
  function evidenceDirectory(overrides = {}) {
    const directory = mkdtempSync(join(tmpdir(), "plvs-package-evidence-"));
    const files = { "agent-control/main.png": "png", "agent-control/main-3s.mp4": "mp4" };
    const artifacts = Object.entries(files).map(([file, contents]) => {
      mkdirSync(join(directory, "agent-control"), { recursive: true });
      writeFileSync(join(directory, file), contents);
      return {
        id: file,
        kind: file.endsWith(".png") ? "image/png" : "video/mp4",
        file,
        bytes: contents.length,
        sha256: createHash("sha256").update(contents).digest("hex"),
      };
    });
    const evidence = {
      schemaVersion: 1,
      domain: "agent-control",
      runId: "run",
      sourceSha: SHA,
      platform: { os: "windows", arch: "x86_64", version: "11" },
      tool: { name: "release-package-smoke", version: 1 },
      startedAt: "2026-10-21T00:00:00.000Z",
      endedAt: "2026-10-21T00:01:00.000Z",
      summary: "complete",
      scenarios: REQUIRED_SCENARIOS.map((id) => ({ id, status: "passed" })),
      artifacts,
      cleanup: { status: "passed", observations: [] },
      warnings: [],
      package: { file: "PLVS-v1.2.3-x64-portable.zip", sha256: "b".repeat(64) },
      ...overrides,
    };
    writeFileSync(join(directory, "result.json"), JSON.stringify(evidence));
    return directory;
  }

  it("accepts complete exact-commit evidence whose files still match", () => {
    const directory = evidenceDirectory();
    expect(verifyReleasePackageEvidence({ directory, sha: SHA, platform: "windows" }).summary).toBe(
      "complete"
    );
  });

  it("rejects another commit, platform, an incomplete run or a changed file", () => {
    const directory = evidenceDirectory();
    expect(() =>
      verifyReleasePackageEvidence({ directory, sha: "c".repeat(40), platform: "windows" })
    ).toThrow(/names/);
    expect(() => verifyReleasePackageEvidence({ directory, sha: SHA, platform: "macos" })).toThrow(
      /is for windows/
    );
    const incomplete = evidenceDirectory({
      summary: "incomplete",
      scenarios: REQUIRED_SCENARIOS.map((id) => ({ id, status: "notRun" })),
    });
    expect(() =>
      verifyReleasePackageEvidence({ directory: incomplete, sha: SHA, platform: "windows" })
    ).toThrow(/incomplete/);
    writeFileSync(join(directory, "agent-control/main.png"), "changed");
    expect(() =>
      verifyReleasePackageEvidence({ directory, sha: SHA, platform: "windows" })
    ).toThrow(/differs/);
  });
});

describe("visual capture resilience", () => {
  const failure = (code) =>
    Object.assign(new Error(`visual screenshot failed (${code})`), { code });

  it("retries an unsettled render once and records the retry", async () => {
    const warnings = [];
    let calls = 0;
    const result = await retryUnsettledRenderOnce(
      "metering screenshot",
      () => {
        calls += 1;
        if (calls === 1) throw failure("renderNotSettled");
        return "captured";
      },
      warnings
    );
    expect(result).toBe("captured");
    expect(calls).toBe(2);
    expect(warnings).toEqual([
      expect.stringContaining("metering screenshot: the render did not settle"),
    ]);
  });

  it("fails on a second unsettled render and never retries other failures", async () => {
    let calls = 0;
    await expect(
      retryUnsettledRenderOnce(
        "screenshot",
        () => {
          calls += 1;
          throw failure("renderNotSettled");
        },
        []
      )
    ).rejects.toThrow("renderNotSettled");
    expect(calls).toBe(2);
    calls = 0;
    await expect(
      retryUnsettledRenderOnce(
        "screenshot",
        () => {
          calls += 1;
          throw failure("revisionConflict");
        },
        []
      )
    ).rejects.toThrow("revisionConflict");
    expect(calls).toBe(1);
  });

  it("keeps only the macOS display awake, for exactly this process", () => {
    const spawned = [];
    const spawnProcess = (command, args) => spawned.push([command, args]) && { kill() {} };
    expect(keepDisplayAwake("windows", 42, spawnProcess)).toBeNull();
    expect(keepDisplayAwake("linux", 42, spawnProcess)).toBeNull();
    expect(keepDisplayAwake("macos", 42, spawnProcess)).not.toBeNull();
    expect(spawned).toEqual([["caffeinate", ["-d", "-i", "-w", "42"]]]);
  });
});
