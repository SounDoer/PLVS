import { describe, expect, it } from "vitest";
import { normalizeDevelopmentFixtureRequest } from "./developmentFixtureProtocol.js";
import { normalizeAgentControlRequest } from "./protocol.js";
import { commandEntries, runningAppWireMethods } from "./commandManifest.js";
import { buildAgentControlCapabilities } from "./appSnapshot.js";

const request = (method, params) => ({ jsonrpc: "2.0", id: "fixture-test", method, params });

describe("development event fixture protocol", () => {
  it("normalizes only the closed establish and reset requests", () => {
    expect(
      normalizeDevelopmentFixtureRequest(
        request("dev.fixture.establish", {
          name: "close-confirmation.requested",
          expectedRevision: 7,
          expectedUiGeneration: 3,
        })
      )
    ).toEqual({
      ok: true,
      request: {
        id: "fixture-test",
        method: "dev.fixture.establish",
        params: {
          name: "close-confirmation.requested",
          expectedRevision: 7,
          expectedUiGeneration: 3,
        },
      },
    });
    expect(
      normalizeDevelopmentFixtureRequest(
        request("dev.fixture.reset", {
          fixtureId: "fixture-aaaaaaaaaaaaaaaa",
          expectedRevision: 7,
          expectedUiGeneration: 4,
        })
      )
    ).toEqual({
      ok: true,
      request: {
        id: "fixture-test",
        method: "dev.fixture.reset",
        params: {
          fixtureId: "fixture-aaaaaaaaaaaaaaaa",
          expectedRevision: 7,
          expectedUiGeneration: 4,
        },
      },
    });
  });

  it("rejects arbitrary fixture payloads, names, ids, and concurrency tokens", () => {
    for (const candidate of [
      request("dev.fixture.establish", {
        name: "arbitrary",
        expectedRevision: 7,
        expectedUiGeneration: 3,
      }),
      request("dev.fixture.establish", {
        name: "update.available",
        payload: { releaseNotes: "caller controlled" },
        expectedRevision: 7,
        expectedUiGeneration: 3,
      }),
      request("dev.fixture.reset", {
        fixtureId: "real-event",
        expectedRevision: 7,
        expectedUiGeneration: 3,
      }),
      request("dev.fixture.reset", {
        fixtureId: "fixture-aaaaaaaaaaaaaaaa",
        expectedRevision: -1,
        expectedUiGeneration: 3,
      }),
    ]) {
      expect(normalizeDevelopmentFixtureRequest(candidate).ok).toBe(false);
    }
  });

  it("is absent from every public frontend discovery boundary", () => {
    expect(commandEntries.some(({ path }) => path[0] === "dev")).toBe(false);
    expect(runningAppWireMethods.some((method) => method.startsWith("dev.fixture."))).toBe(false);
    expect(
      buildAgentControlCapabilities(
        { platform: "windows", visual: { screenshot: true, recording: true } },
        0
      ).methods.some((method) => method.startsWith("dev.fixture."))
    ).toBe(false);
    expect(
      normalizeAgentControlRequest(
        request("dev.fixture.establish", {
          name: "close-confirmation.requested",
          expectedRevision: 0,
          expectedUiGeneration: 0,
        })
      )
    ).toMatchObject({ ok: false, error: { reason: "methodNotFound" } });
  });
});
