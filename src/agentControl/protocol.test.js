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
    "theme.inspect",
    "config.export",
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

  it("normalizes configuration imports as revision-guarded mutations", () => {
    const configuration = {
      app: "PLVS",
      kind: "configuration-profile",
      version: 1,
    };
    expect(
      normalizeAgentControlRequest(
        request("config.import", { configuration, expectedRevision: 3, dryRun: true })
      )
    ).toEqual({
      ok: true,
      request: {
        id: "req-1",
        method: "config.import",
        params: { configuration, expectedRevision: 3, dryRun: true },
      },
    });
    expect(
      normalizeAgentControlRequest(request("config.import", { configuration })).error.path
    ).toBe("$.params.expectedRevision");
    expect(
      normalizeAgentControlRequest(
        request("config.import", { configuration: [], expectedRevision: 3 })
      ).error.path
    ).toBe("$.params.configuration");
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

  it("normalizes Loudness Profile describe and every mutation shape", () => {
    const document = { name: "EBU R128", referenceLufs: -23, rules: [] };
    const cases = [
      ["loudnessProfile.describe", { profileId: "profile-1" }],
      ["loudnessProfile.select", { profileId: "off", expectedRevision: 2, dryRun: true }],
      ["loudnessProfile.create", { document, expectedRevision: 2, dryRun: true }],
      [
        "loudnessProfile.update",
        { profileId: "profile-1", document, expectedRevision: 2, dryRun: true },
      ],
      [
        "loudnessProfile.rename",
        { profileId: "profile-1", name: "Broadcast", expectedRevision: 2, dryRun: true },
      ],
      ["loudnessProfile.delete", { profileId: "profile-1", expectedRevision: 2, dryRun: true }],
      [
        "loudnessProfile.reorder",
        { profileIds: ["profile-2", "profile-1"], expectedRevision: 2, dryRun: true },
      ],
    ];

    for (const [method, params] of cases) {
      expect(normalizeAgentControlRequest(request(method, params))).toEqual({
        ok: true,
        request: { id: "req-1", method, params },
      });
    }
  });

  it("normalizes Theme queries and every mutation shape", () => {
    const document = { version: 2, name: "Studio" };
    const cases = [
      ["theme.describe", { themeId: "plvs-dark" }],
      ["theme.select", { themeId: "plvs-light", expectedRevision: 2, dryRun: true }],
      ["theme.followSystem", { expectedRevision: 2, dryRun: true }],
      ["theme.create", { document, expectedRevision: 2, dryRun: true }],
      ["theme.update", { themeId: "custom-1", document, expectedRevision: 2, dryRun: true }],
      ["theme.rename", { themeId: "custom-1", name: "Studio", expectedRevision: 2, dryRun: true }],
      [
        "theme.duplicate",
        { themeId: "plvs-dark", name: "Copy", expectedRevision: 2, dryRun: true },
      ],
      ["theme.delete", { themeId: "custom-1", expectedRevision: 2, dryRun: true }],
      ["theme.reorder", { themeIds: ["custom-2", "custom-1"], expectedRevision: 2, dryRun: true }],
    ];
    for (const [method, params] of cases) {
      expect(normalizeAgentControlRequest(request(method, params))).toEqual({
        ok: true,
        request: { id: "req-1", method, params },
      });
    }
  });

  it("leaves Theme document semantics to the shared planner", () => {
    const document = { version: 99, unknown: true };
    expect(
      normalizeAgentControlRequest(request("theme.create", { document, expectedRevision: 0 }))
        .request.params.document
    ).toBe(document);
    expect(
      normalizeAgentControlRequest(request("theme.create", { document: [], expectedRevision: 0 }))
        .error.path
    ).toBe("$.params.document");
  });

  it("leaves authoring semantics to the shared planner but requires a plain document", () => {
    const semanticallyInvalid = { name: "", referenceLufs: 99, rules: "no" };
    expect(
      normalizeAgentControlRequest(
        request("loudnessProfile.create", {
          document: semanticallyInvalid,
          expectedRevision: 0,
        })
      ).request.params.document
    ).toBe(semanticallyInvalid);
    expect(
      normalizeAgentControlRequest(
        request("loudnessProfile.create", { document: [], expectedRevision: 0 })
      ).error.path
    ).toBe("$.params.document");
  });

  it.each([
    ["theme.describe", { themeId: "plvs-dark" }],
    ["theme.select", { themeId: "plvs-dark", expectedRevision: 0 }],
    ["theme.followSystem", { expectedRevision: 0 }],
    ["theme.create", { document: {}, expectedRevision: 0 }],
    ["theme.update", { themeId: "custom-1", document: {}, expectedRevision: 0 }],
    ["theme.rename", { themeId: "custom-1", name: "Name", expectedRevision: 0 }],
    ["theme.duplicate", { themeId: "plvs-dark", name: "Copy", expectedRevision: 0 }],
    ["theme.delete", { themeId: "custom-1", expectedRevision: 0 }],
    ["theme.reorder", { themeIds: [], expectedRevision: 0 }],
    ["loudnessProfile.describe", { profileId: "profile-1" }],
    ["loudnessProfile.select", { profileId: "off", expectedRevision: 0 }],
    ["loudnessProfile.create", { document: {}, expectedRevision: 0 }],
    ["loudnessProfile.update", { profileId: "profile-1", document: {}, expectedRevision: 0 }],
    ["loudnessProfile.rename", { profileId: "profile-1", name: "Name", expectedRevision: 0 }],
    ["loudnessProfile.delete", { profileId: "profile-1", expectedRevision: 0 }],
    ["loudnessProfile.reorder", { profileIds: [], expectedRevision: 0 }],
  ])("rejects an unknown field on %s at its own path", (method, params) => {
    expect(
      normalizeAgentControlRequest(request(method, { ...params, extra: true })).error
    ).toMatchObject({ reason: "invalidParams", path: "$.params.extra" });
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
    ["transport.live.clear", { expectedRevision: 1, dryRun: true }],
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
    ["transport.live.start", { expectedRevision: 1, allowStopFileAnalysis: true }],
    ["transport.live.stop", { expectedRevision: 1 }],
    ["transport.file.analyze", { path: "C:\\audio\\mix.wav", expectedRevision: 1 }],
    ["transport.file.reanalyze", { sessionId: "file-1", expectedRevision: 1 }],
    ["transport.file.stop", { sessionId: "file-1", expectedRevision: 1 }],
  ])("normalizes %s action options without dry-run", (method, params) => {
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
    [request("theme.describe", {}), "invalidParams", "$.params.themeId", -32602],
    [request("theme.select", { themeId: " " }), "invalidParams", "$.params.themeId", -32602],
    [request("theme.create", {}), "invalidParams", "$.params.document", -32602],
    [
      request("theme.update", { themeId: "custom-1", document: [] }),
      "invalidParams",
      "$.params.document",
      -32602,
    ],
    [request("theme.rename", { themeId: "custom-1" }), "invalidParams", "$.params.name", -32602],
    [
      request("theme.duplicate", { themeId: "plvs-dark", name: " " }),
      "invalidParams",
      "$.params.name",
      -32602,
    ],
    [request("theme.delete", {}), "invalidParams", "$.params.themeId", -32602],
    [request("theme.reorder", {}), "invalidParams", "$.params.themeIds", -32602],
    [
      request("loudnessProfile.describe", { profileId: "off" }),
      "invalidParams",
      "$.params.profileId",
      -32602,
    ],
    [
      request("loudnessProfile.select", { profileId: " " }),
      "invalidParams",
      "$.params.profileId",
      -32602,
    ],
    [request("loudnessProfile.create", {}), "invalidParams", "$.params.document", -32602],
    [
      request("loudnessProfile.update", { profileId: "profile-1", document: [] }),
      "invalidParams",
      "$.params.document",
      -32602,
    ],
    [
      request("loudnessProfile.rename", { profileId: "profile-1" }),
      "invalidParams",
      "$.params.name",
      -32602,
    ],
    [
      request("loudnessProfile.delete", { profileId: "off" }),
      "invalidParams",
      "$.params.profileId",
      -32602,
    ],
    [request("loudnessProfile.reorder", {}), "invalidParams", "$.params.profileIds", -32602],
    [
      request("loudnessProfile.reorder", { profileIds: [], extra: true }),
      "invalidParams",
      "$.params.extra",
      -32602,
    ],
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
      request("transport.live.start", { expectedRevision: 0, dryRun: true }),
      "invalidParams",
      "$.params.dryRun",
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
    ["preset.import", { pack: { app: "PLVS" } }],
    ["theme.import", { pack: { app: "PLVS" } }],
    ["theme.select", { themeId: "plvs-dark" }],
    ["theme.followSystem", {}],
    ["theme.create", { document: {} }],
    ["theme.update", { themeId: "custom-1", document: {} }],
    ["theme.rename", { themeId: "custom-1", name: "Name" }],
    ["theme.duplicate", { themeId: "plvs-dark", name: "Copy" }],
    ["theme.delete", { themeId: "custom-1" }],
    ["theme.reorder", { themeIds: [] }],
    ["loudnessProfile.import", { pack: { app: "PLVS" } }],
    ["loudnessProfile.select", { profileId: "off" }],
    ["loudnessProfile.create", { document: {} }],
    ["loudnessProfile.update", { profileId: "profile-1", document: {} }],
    ["loudnessProfile.rename", { profileId: "profile-1", name: "Name" }],
    ["loudnessProfile.delete", { profileId: "profile-1" }],
    ["loudnessProfile.reorder", { profileIds: [] }],
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

  describe("library transfer requests", () => {
    const EXPORT_METHODS = ["preset.export", "theme.export", "loudnessProfile.export"];
    const IMPORT_METHODS = ["preset.import", "theme.import", "loudnessProfile.import"];

    it("accepts the theme and loudnessProfile list methods with no params", () => {
      for (const method of ["theme.list", "loudnessProfile.list"]) {
        const normalized = normalizeAgentControlRequest(request(method));
        expect(normalized.request.method).toBe(method);
        expect(normalized.request.params).toEqual({});
      }
    });

    it.each(EXPORT_METHODS)(
      "accepts an export with no ids as a whole-library export (%s)",
      (method) => {
        const normalized = normalizeAgentControlRequest(request(method, {}));
        expect(normalized.request.params.ids).toBeNull();
      }
    );

    it.each(EXPORT_METHODS)("accepts an export with a string id list (%s)", (method) => {
      const normalized = normalizeAgentControlRequest(request(method, { ids: ["t-1", "t-2"] }));
      expect(normalized.request.params.ids).toEqual(["t-1", "t-2"]);
    });

    it.each(EXPORT_METHODS)("rejects an export whose ids are not strings (%s)", (method) => {
      const normalized = normalizeAgentControlRequest(request(method, { ids: [1] }));
      expect(normalized.error).toBeTruthy();
    });

    it.each(EXPORT_METHODS)(
      "rejects an empty ids array as nothing-to-export, not the whole library (%s)",
      (method) => {
        const normalized = normalizeAgentControlRequest(request(method, { ids: [] }));
        expect(normalized).toEqual({
          ok: false,
          error: expect.objectContaining({
            reason: "invalidParams",
            path: "$.params.ids",
            code: -32602,
          }),
        });
      }
    );

    it.each(EXPORT_METHODS)("rejects a whitespace-only id (%s)", (method) => {
      const normalized = normalizeAgentControlRequest(request(method, { ids: ["   "] }));
      expect(normalized).toEqual({
        ok: false,
        error: expect.objectContaining({
          reason: "invalidParams",
          path: "$.params.ids",
          code: -32602,
        }),
      });
    });

    it.each(EXPORT_METHODS)("rejects an empty-string id (%s)", (method) => {
      const normalized = normalizeAgentControlRequest(request(method, { ids: [""] }));
      expect(normalized).toEqual({
        ok: false,
        error: expect.objectContaining({
          reason: "invalidParams",
          path: "$.params.ids",
          code: -32602,
        }),
      });
    });

    it.each(EXPORT_METHODS)("rejects an explicit null ids, unlike an absent one (%s)", (method) => {
      const normalized = normalizeAgentControlRequest(request(method, { ids: null }));
      expect(normalized).toEqual({
        ok: false,
        error: expect.objectContaining({
          reason: "invalidParams",
          path: "$.params.ids",
          code: -32602,
        }),
      });
    });

    it.each(IMPORT_METHODS)("accepts an import carrying a pack object (%s)", (method) => {
      const normalized = normalizeAgentControlRequest(
        request(method, { pack: { app: "PLVS" }, expectedRevision: 3, dryRun: true })
      );
      expect(normalized.request.params.pack).toEqual({ app: "PLVS" });
      expect(normalized.request.params.expectedRevision).toBe(3);
      expect(normalized.request.params.dryRun).toBe(true);
    });

    it.each(IMPORT_METHODS)("rejects an import with no pack (%s)", (method) => {
      const normalized = normalizeAgentControlRequest(request(method, { expectedRevision: 3 }));
      expect(normalized.error).toBeTruthy();
    });

    it.each(IMPORT_METHODS)("rejects a null pack (%s)", (method) => {
      const normalized = normalizeAgentControlRequest(
        request(method, { pack: null, expectedRevision: 3 })
      );
      expect(normalized).toEqual({
        ok: false,
        error: expect.objectContaining({
          reason: "invalidParams",
          path: "$.params.pack",
          code: -32602,
        }),
      });
    });

    it.each(IMPORT_METHODS)("rejects an array pack (%s)", (method) => {
      const normalized = normalizeAgentControlRequest(
        request(method, { pack: [], expectedRevision: 3 })
      );
      expect(normalized).toEqual({
        ok: false,
        error: expect.objectContaining({
          reason: "invalidParams",
          path: "$.params.pack",
          code: -32602,
        }),
      });
    });
  });
});
