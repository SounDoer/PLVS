import { describe, expect, it } from "vitest";
import { normalizeDevelopmentUpdateRequest } from "./developmentUpdateProtocol.js";

const request = (method, params) => ({ jsonrpc: "2.0", id: "update-test", method, params });

describe("development update protocol", () => {
  it("accepts only the bounded packaged-acceptance actions", () => {
    expect(
      normalizeDevelopmentUpdateRequest(
        request("dev.update.preferences", {
          surfaceId: "ui-aaaaaaaaaaaaaaaa",
          autoCheck: true,
          autoDownload: true,
          expectedRevision: 3,
          expectedUiGeneration: 4,
        })
      ).ok
    ).toBe(true);
    expect(
      normalizeDevelopmentUpdateRequest(
        request("dev.update.confirm", {
          surfaceId: "ui-bbbbbbbbbbbbbbbb",
          expectedRevision: 3,
          expectedUiGeneration: 4,
        })
      ).ok
    ).toBe(true);
    for (const method of ["dev.update.open", "dev.update.quit"]) {
      expect(
        normalizeDevelopmentUpdateRequest(
          request(method, { expectedRevision: 3, expectedUiGeneration: 4 })
        ).ok
      ).toBe(true);
    }
  });

  it("rejects arbitrary actions, stale-token omissions and invalid preferences", () => {
    for (const candidate of [
      request("dev.update.evaluate", { script: "arbitrary" }),
      request("dev.update.open", {}),
      request("dev.update.confirm", {
        surfaceId: "not-a-surface",
        expectedRevision: 1,
        expectedUiGeneration: 1,
      }),
      request("dev.update.preferences", {
        surfaceId: "ui-aaaaaaaaaaaaaaaa",
        autoCheck: false,
        autoDownload: true,
        expectedRevision: 1,
        expectedUiGeneration: 1,
      }),
    ]) {
      expect(normalizeDevelopmentUpdateRequest(candidate).ok).toBe(false);
    }
  });
});
