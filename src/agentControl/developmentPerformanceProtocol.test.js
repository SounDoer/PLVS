import { describe, expect, it } from "vitest";
import { buildAgentControlCapabilities } from "./appSnapshot.js";
import { commandEntries, runningAppWireMethods } from "./commandManifest.js";
import {
  DEVELOPMENT_PERFORMANCE_STALL_MAX_MS,
  DEVELOPMENT_PERFORMANCE_STALL_MIN_MS,
  normalizeDevelopmentPerformanceRequest,
} from "./developmentPerformanceProtocol.js";
import { normalizeAgentControlRequest } from "./protocol.js";

const request = (method, params) => ({ jsonrpc: "2.0", id: "performance-test", method, params });

describe("development performance protocol", () => {
  it("normalizes only the fixed inspect and bounded stall requests", () => {
    expect(normalizeDevelopmentPerformanceRequest(request("dev.performance.inspect", {}))).toEqual({
      ok: true,
      request: { id: "performance-test", method: "dev.performance.inspect", params: {} },
    });
    expect(
      normalizeDevelopmentPerformanceRequest(
        request("dev.performance.stall", { milliseconds: DEVELOPMENT_PERFORMANCE_STALL_MAX_MS })
      )
    ).toEqual({
      ok: true,
      request: {
        id: "performance-test",
        method: "dev.performance.stall",
        params: { milliseconds: DEVELOPMENT_PERFORMANCE_STALL_MAX_MS },
      },
    });
  });

  it("rejects arbitrary payloads and stalls outside the closed bound", () => {
    for (const candidate of [
      request("dev.performance.inspect", { script: "arbitrary" }),
      request("dev.performance.stall", { milliseconds: DEVELOPMENT_PERFORMANCE_STALL_MIN_MS - 1 }),
      request("dev.performance.stall", { milliseconds: DEVELOPMENT_PERFORMANCE_STALL_MAX_MS + 1 }),
      request("dev.performance.stall", { milliseconds: 1_000, script: "arbitrary" }),
      request("dev.performance.evaluate", { script: "arbitrary" }),
    ]) {
      expect(normalizeDevelopmentPerformanceRequest(candidate).ok).toBe(false);
    }
  });

  it("is absent from every public frontend discovery boundary", () => {
    expect(commandEntries.some(({ path }) => path[0] === "dev")).toBe(false);
    expect(runningAppWireMethods.some((method) => method.startsWith("dev.performance."))).toBe(
      false
    );
    expect(
      buildAgentControlCapabilities(
        { platform: "windows", visual: { screenshot: true, recording: true } },
        0
      ).methods.some((method) => method.startsWith("dev.performance."))
    ).toBe(false);
    expect(normalizeAgentControlRequest(request("dev.performance.inspect", {}))).toMatchObject({
      ok: false,
      error: { reason: "methodNotFound" },
    });
  });
});
