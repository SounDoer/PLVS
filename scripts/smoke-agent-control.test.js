import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseJsonEnvelope,
  verifyArtifactBuffer,
  verifyUiSurface,
  parseArgs,
  selectSmokeInstance,
  runAgentControlSmoke,
} from "./smoke-agent-control.mjs";

describe("Agent Control smoke helpers", () => {
  it("accepts only successful JSON envelopes", () => {
    expect(parseJsonEnvelope("inspect", '{"ok":true,"result":{"revision":4}}')).toEqual({
      ok: true,
      result: { revision: 4 },
    });
    expect(() => parseJsonEnvelope("inspect", "not json")).toThrow("invalid JSON");
    expect(() => parseJsonEnvelope("inspect", 'banner\n{"ok":true,"result":{}}')).toThrow(
      "invalid JSON"
    );
    expect(() =>
      parseJsonEnvelope(
        "inspect",
        '{"ok":false,"error":{"code":"appNotRunning","message":"Start PLVS."}}'
      )
    ).toThrow("appNotRunning");
  });

  it("requires an exact settled semantic UI surface", () => {
    const surface = {
      surfaceId: `ui-${"a".repeat(16)}`,
      kind: "settings",
      target: { section: "appearance" },
    };
    expect(
      verifyUiSurface(
        { uiGeneration: 3, surface },
        { kind: "settings", target: { section: "appearance" } }
      )
    ).toBe(surface);
    expect(() =>
      verifyUiSurface(
        { uiGeneration: 3, surface },
        { kind: "settings", target: { section: "behavior" } }
      )
    ).toThrow("wrong settings target");
  });

  it("verifies artifact type, size, and SHA-256", () => {
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const metadata = {
      bytes: png.length,
      sha256: createHash("sha256").update(png).digest("hex"),
    };
    expect(verifyArtifactBuffer("screenshot", png, metadata)).toEqual(metadata);
    expect(() => verifyArtifactBuffer("screenshot", Buffer.from("bad"), metadata)).toThrow();
  });
});

describe("desktop smoke orchestration", () => {
  const directories = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  function rig({ initialUi = {}, failScreenshot = false, showChanged = true } = {}) {
    const outDir = mkdtempSync(join(tmpdir(), "plvs-smoke-test-"));
    directories.push(outDir);
    const methods = [
      "app.capabilities",
      "app.inspect",
      "ui.inspect",
      "ui.show.settings",
      "ui.close",
      "visual.screenshot",
      "visual.recording.start",
      "visual.recording.wait",
    ];
    const surface = {
      surfaceId: "owned-settings",
      kind: "settings",
      target: { section: "appearance" },
    };
    const ui = {
      revision: 4,
      uiGeneration: 0,
      surfaces: [],
      activeBlockingEditors: [],
      window: { form: "normal", visible: true },
      ...initialUi,
    };
    const invoke = vi.fn((label, args) => {
      let result;
      switch (label) {
        case "instances":
          result = { instances: [{ instanceId: "one" }, { instanceId: "two" }] };
          break;
        case "capabilities":
          result = { methods };
          break;
        case "inspect":
          result = { revision: 3 };
          break;
        case "ui inspect":
          result = ui;
          break;
        case "ui show settings":
          result = { revision: 4, uiGeneration: 1, changed: showChanged, surface };
          break;
        case "ui close":
        case "ui close cleanup":
          result = {};
          break;
        case "ui inspect cleanup":
          result = { ...ui, surfaces: [surface], uiGeneration: 1 };
          break;
        case "ui inspect final":
          result = { ...ui, revision: 5, uiGeneration: 2 };
          break;
        case "visual recording start":
          result = { recording: { recordingId: "owned-recording" } };
          break;
        case "visual screenshot":
        case "visual recording wait": {
          if (failScreenshot && label === "visual screenshot") throw new Error("capture failed");
          const contents =
            label === "visual screenshot"
              ? Buffer.from("89504e470d0a1a0a", "hex")
              : Buffer.from("0000000066747970", "hex");
          writeFileSync(args[args.indexOf("--out") + 1], contents);
          const artifact = {
            bytes: contents.length,
            sha256: createHash("sha256").update(contents).digest("hex"),
          };
          result =
            label === "visual screenshot"
              ? { revision: 4, uiGeneration: 1, artifact }
              : { outcome: "terminal", recording: { state: "completed", artifact } };
          break;
        }
        default:
          throw new Error(`Unexpected call: ${label}`);
      }
      return { ok: true, result };
    });
    return { outDir, invoke };
  }

  it("parses explicit selectors and refuses ambiguous or missing instances", () => {
    expect(parseArgs(["--instance", "two"]).instanceId).toBe("two");
    expect(() => parseArgs(["--instance"])).toThrow("Usage");
    expect(() => parseArgs(["--instance", "one", "--instance", "two"])).toThrow("Usage");
    expect(selectSmokeInstance([{ instanceId: "one" }])).toBe("one");
    expect(() => selectSmokeInstance([])).toThrow("requires one");
    expect(() => selectSmokeInstance([{ instanceId: "one" }, { instanceId: "two" }])).toThrow(
      "requires one"
    );
    expect(() => selectSmokeInstance([{ instanceId: "one" }], "missing")).toThrow("not found");
  });

  it.each([
    { surfaces: [{ surfaceId: "existing", kind: "settings" }] },
    { activeBlockingEditors: ["theme"] },
    { window: { form: "dock", visible: true } },
    { window: { form: "normal", visible: false } },
  ])("refuses unsafe initial UI without navigation or cleanup: %j", async (initialUi) => {
    const options = rig({ initialUi });
    await expect(runAgentControlSmoke({ ...options, instanceId: "one" })).rejects.toThrow();
    expect(options.invoke.mock.calls.map(([label]) => label)).toEqual([
      "instances",
      "capabilities",
      "inspect",
      "ui inspect",
    ]);
  });

  it("pins explicit instance over environment for every command and records it", async () => {
    vi.stubEnv("PLVS_INSTANCE_ID", "one");
    const options = rig();
    const { report } = await runAgentControlSmoke({ ...options, instanceId: "two" });
    expect(report.instanceId).toBe("two");
    for (const [, args] of options.invoke.mock.calls.slice(1))
      expect(args.slice(-2)).toEqual(["--instance", "two"]);
    const start = options.invoke.mock.calls.find(
      ([label]) => label === "visual recording start"
    )[1];
    expect(start[start.indexOf("--expected-revision") + 1]).toBe("5");
  });

  it("cleans up only its created surface in the pinned instance after failure", async () => {
    vi.stubEnv("PLVS_INSTANCE_ID", "two");
    const options = rig({ failScreenshot: true });
    await expect(runAgentControlSmoke(options)).rejects.toThrow("capture failed");
    const cleanup = options.invoke.mock.calls.find(([label]) => label === "ui close cleanup")[1];
    expect(cleanup.slice(0, 3)).toEqual(["ui", "close", "owned-settings"]);
    expect(cleanup.slice(-2)).toEqual(["--instance", "two"]);
  });

  it("never closes a reused surface", async () => {
    const options = rig({ showChanged: false });
    await expect(runAgentControlSmoke({ ...options, instanceId: "one" })).rejects.toThrow(
      "did not create"
    );
    expect(options.invoke.mock.calls.some(([label]) => label.includes("close"))).toBe(false);
  });
});
