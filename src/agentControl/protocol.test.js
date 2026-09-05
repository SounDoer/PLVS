import { describe, expect, it } from "vitest";
import { normalizeAgentControlRequest } from "./protocol.js";

function request(method, params = {}) {
  return { jsonrpc: "2.0", id: "req-1", method, params };
}

describe("normalizeAgentControlRequest", () => {
  it.each([
    "app.capabilities",
    "app.inspect",
    "axis.describe",
    "axis.inspect",
    "settings.describe",
    "settings.inspect",
    "transport.inspect",
    "dock.describe",
    "dock.inspect",
  ])("accepts %s with empty params", (method) => {
    expect(normalizeAgentControlRequest(request(method))).toEqual({
      ok: true,
      request: { id: "req-1", method, params: {} },
    });
  });

  it("normalizes Preset read commands", () => {
    expect(normalizeAgentControlRequest(request("preset.list"))).toEqual({
      ok: true,
      request: { id: "req-1", method: "preset.list", params: {} },
    });
    expect(
      normalizeAgentControlRequest(request("preset.describe", { presetId: "preset-1" }))
    ).toEqual({
      ok: true,
      request: {
        id: "req-1",
        method: "preset.describe",
        params: { presetId: "preset-1" },
      },
    });
  });

  it.each([
    [
      "preset.rename",
      { presetId: "preset-1", name: "New Name", expectedRevision: 2, dryRun: true },
    ],
    ["preset.delete", { presetId: "preset-1", expectedRevision: 2, dryRun: true }],
    ["preset.reorder", { presetIds: ["preset-2", "preset-1"], expectedRevision: 2, dryRun: true }],
  ])("normalizes %s library mutation", (method, params) => {
    expect(normalizeAgentControlRequest(request(method, params))).toEqual({
      ok: true,
      request: { id: "req-1", method, params },
    });
  });

  it.each([
    [
      "preset.save",
      {
        name: "New Mix",
        expectedRevision: 2,
        dryRun: true,
      },
    ],
    [
      "preset.update",
      {
        presetId: "preset-1",
        expectedRevision: 2,
        dryRun: true,
      },
    ],
    [
      "preset.apply",
      {
        presetId: "preset-1",
        expectedRevision: 2,
        dryRun: true,
      },
    ],
  ])("normalizes %s scene capture", (method, params) => {
    expect(normalizeAgentControlRequest(request(method, params))).toEqual({
      ok: true,
      request: { id: "req-1", method, params },
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

  it("normalizes settings.update options", () => {
    const params = {
      patch: { closeBehavior: "tray", interfaceSize: "large" },
      expectedRevision: 2,
      allowMeasurementRestart: true,
      dryRun: true,
    };
    expect(normalizeAgentControlRequest(request("settings.update", params))).toEqual({
      ok: true,
      request: { id: "req-1", method: "settings.update", params },
    });
  });

  it("normalizes app.wait baselines and timeout", () => {
    const params = { afterRevision: 2, timeoutMs: 5000 };
    expect(normalizeAgentControlRequest(request("app.wait", params))).toEqual({
      ok: true,
      request: { id: "req-1", method: "app.wait", params },
    });
  });

  it.each([
    ["transport.source.live", { expectedRevision: 1, allowStopFileAnalysis: true, dryRun: true }],
    ["transport.source.file", { expectedRevision: 1, dryRun: true }],
    ["transport.live.start", { expectedRevision: 1, allowStopFileAnalysis: true, dryRun: true }],
    ["transport.live.stop", { expectedRevision: 1, dryRun: true }],
    ["transport.live.clear", { expectedRevision: 1, dryRun: true }],
    ["transport.file.analyze", { path: "C:\\audio\\mix.wav", expectedRevision: 1, dryRun: true }],
    ["transport.file.reanalyze", { sessionId: "file-1", expectedRevision: 1, dryRun: true }],
    ["transport.file.stop", { sessionId: "file-1", expectedRevision: 1, dryRun: true }],
    ["transport.file.select", { sessionId: "file-1", expectedRevision: 1, dryRun: true }],
    ["transport.file.remove", { sessionId: "file-1", expectedRevision: 1, dryRun: true }],
    ["transport.file.clear", { expectedRevision: 1, dryRun: true }],
  ])("normalizes %s mutation options", (method, params) => {
    expect(normalizeAgentControlRequest(request(method, params))).toEqual({
      ok: true,
      request: { id: "req-1", method, params },
    });
  });

  it.each([
    [
      "dock.enter",
      {
        edge: "top",
        monitor: "monitor-1",
        reserveSpace: false,
        height: 72,
        expectedRevision: 2,
        dryRun: true,
      },
    ],
    ["dock.exit", { expectedRevision: 2, dryRun: true }],
    ["dock.layout.apply", { layout: { panels: [] }, expectedRevision: 2, dryRun: true }],
    [
      "dock.panel.update",
      { panelId: "level", patch: { mode: "rms" }, expectedRevision: 2, dryRun: true },
    ],
    ["dock.panel.reset", { panelId: "level", expectedRevision: 2, dryRun: true }],
  ])("normalizes %s options", (method, params) => {
    expect(normalizeAgentControlRequest(request(method, params))).toEqual({
      ok: true,
      request: { id: "req-1", method, params },
    });
  });

  it("normalizes dock.panel.describe", () => {
    expect(
      normalizeAgentControlRequest(request("dock.panel.describe", { panelId: "level" }))
    ).toEqual({
      ok: true,
      request: { id: "req-1", method: "dock.panel.describe", params: { panelId: "level" } },
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
    [
      "axis.shared.update",
      { kind: "frequency", range: { minHz: 200, maxHz: 5000 }, expectedRevision: 2, dryRun: true },
    ],
    ["axis.shared.reset", { kind: "time", expectedRevision: 2, dryRun: true }],
    [
      "axis.panel.update",
      {
        panelId: "spectrum",
        kind: "frequency",
        patch: { linked: false },
        expectedRevision: 2,
        dryRun: true,
      },
    ],
    [
      "axis.panel.reset",
      { panelId: "spectrum", kind: "frequency", expectedRevision: 2, dryRun: true },
    ],
  ])("normalizes %s mutation params", (method, params) => {
    expect(normalizeAgentControlRequest(request(method, params))).toEqual({
      ok: true,
      request: { id: "req-1", method, params },
    });
  });

  it.each([
    [request("unknown"), "methodNotFound", "$.method", -32601],
    [{ ...request("app.inspect"), extra: true }, "invalidRequest", "$.extra", -32600],
    [request("app.inspect", { extra: true }), "invalidParams", "$.params.extra", -32602],
    [request("axis.inspect", { extra: true }), "invalidParams", "$.params.extra", -32602],
    [request("preset.list", { extra: true }), "invalidParams", "$.params.extra", -32602],
    [request("preset.describe", {}), "invalidParams", "$.params.presetId", -32602],
    [request("preset.rename", { presetId: "preset-1" }), "invalidParams", "$.params.name", -32602],
    [request("preset.delete", {}), "invalidParams", "$.params.presetId", -32602],
    [request("preset.reorder", {}), "invalidParams", "$.params.presetIds", -32602],
    [request("preset.save", {}), "invalidParams", "$.params.name", -32602],
    [request("preset.update", {}), "invalidParams", "$.params.presetId", -32602],
    [request("settings.update", {}), "invalidParams", "$.params.patch", -32602],
    [request("app.wait", {}), "invalidParams", "$.params.afterRevision", -32602],
    [request("transport.file.analyze", {}), "invalidParams", "$.params.path", -32602],
    [request("transport.file.select", {}), "invalidParams", "$.params.sessionId", -32602],
    [request("dock.layout.apply", {}), "invalidParams", "$.params.layout", -32602],
    [request("dock.panel.update", { panelId: "level" }), "invalidParams", "$.params.patch", -32602],
    [request("dock.panel.reset", {}), "invalidParams", "$.params.panelId", -32602],
    [request("dock.enter", { height: 72.5 }), "invalidParams", "$.params.height", -32602],
    [
      request("transport.live.start", { allowStopFileAnalysis: "yes" }),
      "invalidParams",
      "$.params.allowStopFileAnalysis",
      -32602,
    ],
    [
      request("transport.live.stop", { expectedRevision: -1 }),
      "invalidParams",
      "$.params.expectedRevision",
      -32602,
    ],
    [
      request("app.wait", { afterRevision: 0, timeoutMs: 99 }),
      "invalidParams",
      "$.params.timeoutMs",
      -32602,
    ],
    [
      request("preset.describe", { presetId: "preset-1", expectedRevision: -1 }),
      "invalidParams",
      "$.params.expectedRevision",
      -32602,
    ],
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
    [
      request("axis.shared.update", { kind: "frequency" }),
      "invalidParams",
      "$.params.range",
      -32602,
    ],
    [request("axis.shared.reset", {}), "invalidParams", "$.params.kind", -32602],
    [
      request("axis.panel.update", { panelId: "spectrum", kind: "frequency" }),
      "invalidParams",
      "$.params.patch",
      -32602,
    ],
    [
      request("axis.panel.reset", { panelId: "spectrum", kind: "frequency", dryRun: "yes" }),
      "invalidParams",
      "$.params.dryRun",
      -32602,
    ],
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

  it.each([
    ["workspace.applyLayout", { layout: {} }],
    ["panel.reset", { panelId: "spectrum" }],
    ["axis.shared.reset", { kind: "frequency" }],
    ["preset.delete", { presetId: "preset-1" }],
    ["settings.update", { patch: {} }],
    ["transport.live.stop", {}],
    ["dock.exit", {}],
  ])("requires expectedRevision for %s", (method, params) => {
    expect(normalizeAgentControlRequest(request(method, params))).toEqual({
      ok: false,
      error: expect.objectContaining({
        reason: "revisionRequired",
        path: "$.params.expectedRevision",
        code: -32602,
      }),
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
