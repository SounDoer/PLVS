import { describe, expect, it, vi } from "vitest";
import {
  createAcceptanceInvoker,
  parseAgentControlAcceptanceArgs,
  runDockPlatformContract,
} from "./accept-agent-control.mjs";

describe("Agent Control acceptance arguments", () => {
  it("accepts an optional instance and output directory", () => {
    const parsed = parseAgentControlAcceptanceArgs([
      "--instance",
      "dev-one",
      "--out-dir",
      "artifacts/custom-agent-control",
    ]);
    expect(parsed.instanceId).toBe("dev-one");
    expect(parsed.outDir).toMatch(/artifacts\/custom-agent-control$/);
  });

  it("rejects missing, repeated, and unknown arguments", () => {
    expect(() => parseAgentControlAcceptanceArgs(["--instance"])).toThrow("Usage");
    expect(() =>
      parseAgentControlAcceptanceArgs(["--instance", "one", "--instance", "two"])
    ).toThrow("Usage");
    expect(() => parseAgentControlAcceptanceArgs(["--unknown", "value"])).toThrow("Usage");
  });
});

describe("Agent Control acceptance invocation", () => {
  it("parses successful and expected failed JSON envelopes", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0, stdout: '{"ok":true,"result":{"revision":4}}\n' })
      .mockReturnValueOnce({
        status: 1,
        stdout:
          '{"ok":false,"error":{"code":"controlsUnavailable","details":{"reason":"controlsUnavailable"}}}\n',
      })
      .mockReturnValueOnce({ status: 0, stdout: "completion script\n" });
    const invoke = createAcceptanceInvoker("plvs-cli", run);
    expect(invoke.success(["inspect", "--json"])).toEqual({ revision: 4 });
    expect(invoke.outcome(["dock", "enter", "--json"])).toMatchObject({
      failed: true,
      envelope: { ok: false, error: { code: "controlsUnavailable" } },
    });
    expect(invoke.text(["completion", "bash"])).toBe("completion script\n");
  });
});

describe("Dock platform acceptance", () => {
  it("treats Linux unsupported behavior as an explicit passing contract", async () => {
    const run = vi.fn(async (args, options) => {
      if (args[1] === "describe") return { supported: false };
      if (args[1] === "inspect") return { revision: 7 };
      expect(options).toEqual({ allowFailure: true });
      return {
        failed: true,
        envelope: { error: { code: "controlsUnavailable" } },
      };
    });
    await expect(runDockPlatformContract(run, { os: "linux" })).resolves.toEqual([
      expect.stringContaining("unsupported"),
    ]);
  });

  it("requires supported platforms to accept a guarded dry-run", async () => {
    const run = vi.fn(async (args) => {
      if (args[1] === "describe") return { supported: true };
      if (args[1] === "inspect") return { revision: 9 };
      return { changed: false };
    });
    await expect(runDockPlatformContract(run, { os: "windows" })).resolves.toEqual([
      expect.stringContaining("guarded dry-run"),
    ]);
    expect(run).toHaveBeenLastCalledWith([
      "dock",
      "enter",
      "--dry-run",
      "--expected-revision",
      "9",
      "--json",
    ]);
  });
});
