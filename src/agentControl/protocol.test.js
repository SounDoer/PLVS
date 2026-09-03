import { describe, expect, it } from "vitest";
import { normalizeAgentControlRequest } from "./protocol.js";

function request(method, params = {}) {
  return { jsonrpc: "2.0", id: "req-1", method, params };
}

describe("normalizeAgentControlRequest", () => {
  it.each(["app.capabilities", "app.inspect"])("accepts %s with empty params", (method) => {
    expect(normalizeAgentControlRequest(request(method))).toEqual({
      ok: true,
      request: { id: "req-1", method, params: {} },
    });
  });

  it("normalizes workspace.applyLayout options", () => {
    const layout = { type: "panel", panelId: "spectrum" };
    expect(
      normalizeAgentControlRequest(
        request("workspace.applyLayout", {
          layout,
          expectedRevision: 42,
          dryRun: true,
        })
      )
    ).toEqual({
      ok: true,
      request: {
        id: "req-1",
        method: "workspace.applyLayout",
        params: { layout, expectedRevision: 42, dryRun: true },
      },
    });
  });

  it("normalizes panel.update params and options", () => {
    const patch = { mode: "rms", playbackMax: true };
    expect(
      normalizeAgentControlRequest(
        request("panel.update", {
          panelId: "levelMeter",
          patch,
          expectedRevision: 7,
          dryRun: true,
        })
      )
    ).toEqual({
      ok: true,
      request: {
        id: "req-1",
        method: "panel.update",
        params: { panelId: "levelMeter", patch, expectedRevision: 7, dryRun: true },
      },
    });
  });

  it("normalizes panel.reset params and options", () => {
    expect(
      normalizeAgentControlRequest(
        request("panel.reset", {
          panelId: "spectrum",
          expectedRevision: 7,
          dryRun: true,
        })
      )
    ).toEqual({
      ok: true,
      request: {
        id: "req-1",
        method: "panel.reset",
        params: { panelId: "spectrum", expectedRevision: 7, dryRun: true },
      },
    });
  });

  it("normalizes a panel.describe target", () => {
    expect(
      normalizeAgentControlRequest(request("panel.describe", { panelId: "spectrum" }))
    ).toEqual({
      ok: true,
      request: {
        id: "req-1",
        method: "panel.describe",
        params: { panelId: "spectrum" },
      },
    });
  });

  it.each([
    [request("unknown"), "methodNotFound", "$.method", -32601],
    [{ ...request("app.inspect"), extra: true }, "invalidRequest", "$.extra", -32600],
    [request("app.inspect", { extra: true }), "invalidParams", "$.params.extra", -32602],
    [request("app.inspect", []), "invalidParams", "$.params", -32602],
    [request("workspace.applyLayout", {}), "invalidParams", "$.params.layout", -32602],
    [request("workspace.applyLayout", { layout: [] }), "invalidParams", "$.params.layout", -32602],
    [
      request("workspace.applyLayout", { layout: {}, expectedRevision: -1 }),
      "invalidParams",
      "$.params.expectedRevision",
      -32602,
    ],
    [
      request("workspace.applyLayout", {
        layout: {},
        expectedRevision: Number.MAX_SAFE_INTEGER + 1,
      }),
      "invalidParams",
      "$.params.expectedRevision",
      -32602,
    ],
    [
      request("workspace.applyLayout", { layout: {}, dryRun: "yes" }),
      "invalidParams",
      "$.params.dryRun",
      -32602,
    ],
    [request("panel.update", { patch: {} }), "invalidParams", "$.params.panelId", -32602],
    [request("panel.update", { panelId: "levelMeter" }), "invalidParams", "$.params.patch", -32602],
    [request("panel.reset", {}), "invalidParams", "$.params.panelId", -32602],
    [request("panel.describe", {}), "invalidParams", "$.params.panelId", -32602],
    [
      request("panel.describe", { panelId: "spectrum", extra: true }),
      "invalidParams",
      "$.params.extra",
      -32602,
    ],
    [
      request("panel.reset", { panelId: "spectrum", patch: {} }),
      "invalidParams",
      "$.params.patch",
      -32602,
    ],
    [
      request("panel.update", { panelId: "levelMeter", patch: {}, expectedRevision: -1 }),
      "invalidParams",
      "$.params.expectedRevision",
      -32602,
    ],
    [
      request("panel.update", { panelId: "levelMeter", patch: {}, extra: true }),
      "invalidParams",
      "$.params.extra",
      -32602,
    ],
  ])("returns a structured error for invalid input %#", (input, reason, path, code) => {
    expect(normalizeAgentControlRequest(input)).toEqual({
      ok: false,
      error: expect.objectContaining({ reason, path, code }),
    });
  });

  it("rejects prototype-bearing request and params objects", () => {
    const inherited = Object.create({ injected: true });
    Object.assign(inherited, request("app.inspect"));
    expect(normalizeAgentControlRequest(inherited)).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "invalidRequest", path: "$" }),
    });

    const params = Object.create({ injected: true });
    expect(normalizeAgentControlRequest(request("app.inspect", params))).toEqual({
      ok: false,
      error: expect.objectContaining({ reason: "invalidParams", path: "$.params" }),
    });
  });
});
