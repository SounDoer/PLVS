/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { WorkspaceProvider, useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { SceneOperationBlockedError } from "../lib/sceneOperations.js";
import { useAgentControlBridge } from "./useAgentControlBridge.js";
import { presetWorkspaceView } from "../lib/presetWorkspaceView.js";

const adapter = vi.hoisted(() => ({
  handler: null,
  order: [],
  responses: [],
  unlisten: vi.fn(),
  listen: vi.fn(async (handler) => {
    adapter.order.push("listen");
    adapter.handler = handler;
    return adapter.unlisten;
  }),
  ready: vi.fn(async () => adapter.order.push("ready")),
  notReady: vi.fn(async () => adapter.order.push("not-ready")),
  respond: vi.fn(async (response) => adapter.responses.push(response)),
}));

vi.mock("../ipc/agentControlEvents.js", () => ({
  listenForAgentControlRequests: adapter.listen,
  announceAgentControlFrontendReady: adapter.ready,
  announceAgentControlFrontendNotReady: adapter.notReady,
  respondToAgentControlRequest: adapter.respond,
}));

const runtime = {
  available: true,
  appName: "PLVS Dev",
  appVersion: "0.14.5",
  identifier: "com.soundoer.plvs.dev",
  platform: "windows",
};

const publicSettings = {
  openAtLogin: false,
  closeBehavior: "ask",
  clearShortcut: { accelerator: "CmdOrCtrl+K", global: false },
  interfaceSize: "default",
  appearance: { mode: "system", themeId: null, resolvedThemeId: "plvs-dark" },
  historyRetentionSec: 3600,
  dialogueVadEngine: "firered",
  channelLabels: { channelCount: 2, mode: "auto", roles: ["L", "R"] },
};

const settingsContext = {
  autostartReady: true,
  clearShortcutReady: true,
  clearShortcutCapturing: false,
  themeOptions: [
    { id: "plvs-dark", name: "Dark", kind: "builtin" },
    { id: "plvs-light", name: "Light", kind: "builtin" },
  ],
  activeEditors: [],
  dialogueDetectionActive: false,
  sourceMode: "live",
};

const transport = {
  source: "live",
  live: {
    state: "stopped",
    requestedDeviceId: "default",
    resolvedDeviceId: null,
    startedAt: null,
    atLiveEdge: true,
    error: null,
  },
  files: { activeId: null, analyzingId: null, sessions: [] },
};

const dock = {
  supported: true,
  enabled: false,
  edge: "bottom",
  monitor: null,
  reserveSpace: true,
  height: 72,
  suspended: false,
  panelsById: { transport: { id: "transport", moduleId: "transport" } },
  panelOrder: ["transport"],
  panelSizesById: {},
  controlsByPanelId: {},
};

const MUTATION_METHODS = new Set([
  "workspace.applyLayout",
  "panel.update",
  "panel.reset",
  "axis.shared.update",
  "axis.shared.reset",
  "axis.panel.update",
  "axis.panel.reset",
  "preset.save",
  "preset.update",
  "preset.apply",
  "preset.rename",
  "preset.delete",
  "preset.reorder",
  "settings.update",
  "transport.source.live",
  "transport.source.file",
  "transport.live.start",
  "transport.live.stop",
  "transport.live.clear",
  "transport.file.analyze",
  "transport.file.reanalyze",
  "transport.file.stop",
  "transport.file.select",
  "transport.file.remove",
  "transport.file.clear",
  "dock.enter",
  "dock.exit",
  "dock.layout.apply",
  "dock.panel.update",
  "dock.panel.reset",
]);

function request(method, params = {}, id = "req-1") {
  return {
    jsonrpc: "2.0",
    id,
    method,
    params:
      MUTATION_METHODS.has(method) && params.expectedRevision === undefined
        ? { ...params, expectedRevision: 0 }
        : params,
  };
}

function Harness({
  enabled = true,
  flush = vi.fn(async () => {}),
  hasLoudnessReference = false,
  analysisContext = {},
  loudnessProfiles = [],
  capturePresetSnapshot = async () => ({ tree: { type: "leaf" }, windowPinned: false }),
  assertPresetOperationAllowed = () => {},
  agentSettings = publicSettings,
  agentSettingsContext = settingsContext,
  agentTransport = transport,
  agentDock = dock,
  agentDockContext = {},
  executeAgentDock,
  controlledAgentSettings = false,
  executeAgentTransport,
  presets = { activeId: null, dirty: false },
  applyPresetToWorkspace = false,
  onStore = () => {},
}) {
  const store = useWorkspaceStore();
  const [presetState, setPresetState] = useState(presets);
  const [settingsState, setSettingsState] = useState(agentSettings);
  const effectiveSettings = controlledAgentSettings ? agentSettings : settingsState;
  const [transportState, setTransportState] = useState(agentTransport);
  const [dockState, setDockState] = useState(agentDock);
  const controlledPresets = {
    ...presetState,
    rename: (id, name) =>
      setPresetState((current) => ({
        ...current,
        list: current.list.map((preset) => (preset.id === id ? { ...preset, name } : preset)),
      })),
    remove: (id) =>
      setPresetState((current) => ({
        ...current,
        list: current.list.filter((preset) => preset.id !== id),
        activeId: current.activeId === id ? null : current.activeId,
        dirty: current.activeId === id ? false : current.dirty,
      })),
    reorder: (ids) =>
      setPresetState((current) => {
        const byId = new Map(current.list.map((preset) => [preset.id, preset]));
        return { ...current, list: ids.map((id) => byId.get(id)) };
      }),
    captureSnapshot: capturePresetSnapshot,
    assertSceneOperationAllowed: assertPresetOperationAllowed,
    saveSnapshot: (name, snapshot) => {
      const preset = { id: "preset-new", name, ...snapshot };
      setPresetState((current) => ({
        list: [...current.list, preset],
        activeId: preset.id,
        dirty: false,
      }));
      return preset;
    },
    updateSnapshot: (id, snapshot) => {
      let updated = null;
      setPresetState((current) => ({
        list: current.list.map((preset) => {
          if (preset.id !== id) return preset;
          updated = { id, name: preset.name, ...snapshot };
          return updated;
        }),
        activeId: id,
        dirty: false,
      }));
      return updated;
    },
    activateSnapshot: (id) => {
      setPresetState((current) => ({ ...current, activeId: id, dirty: false }));
      return true;
    },
    applySnapshot: async (id) => {
      if (applyPresetToWorkspace) {
        const preset = presetState.list.find((entry) => entry.id === id);
        // What the real applySnapshot does: the Workspace it installs is the *migrated* view of
        // the Preset, never the stored record itself.
        if (preset) store.replaceWorkspace(presetWorkspaceView(preset));
      }
      setPresetState((current) => ({ ...current, activeId: id, dirty: false }));
      return true;
    },
    preflightApplySnapshot: () => true,
  };
  onStore(store);
  const executeTransport =
    executeAgentTransport ??
    (async (method) => {
      if (method === "transport.source.file") {
        setTransportState((current) => ({ ...current, source: "file" }));
      } else if (method === "transport.source.live") {
        setTransportState((current) => ({ ...current, source: "live" }));
      } else if (method === "transport.live.start") {
        setTransportState((current) => ({
          ...current,
          source: "live",
          live: { ...current.live, state: "running", resolvedDeviceId: "device-1" },
        }));
      }
    });
  const executeDock =
    executeAgentDock ??
    (async (_method, projected) => {
      setDockState(projected);
    });
  useAgentControlBridge({
    enabled,
    runtime,
    workspace: store.state,
    replaceWorkspace: store.replaceWorkspace,
    setPanelControlsForPanel: store.setPanelControlsForPanel,
    waitForWorkspacePersistenceEnqueue: store.waitForWorkspacePersistenceEnqueue,
    presets: controlledPresets,
    settings: effectiveSettings,
    settingsContext: agentSettingsContext,
    applySettings: async (next) => setSettingsState(next),
    transport: transportState,
    transportContext: { docked: false },
    executeTransport,
    dock: dockState,
    dockContext: {
      platform: "windows",
      monitors: [],
      sourceMode: "live",
      activeEditors: [],
      ...agentDockContext,
    },
    executeDock,
    hasLoudnessReference,
    analysisContext,
    loudnessProfiles,
    flush,
  });
  return null;
}

function mount(options = {}) {
  let store = null;
  const rendered = render(
    <WorkspaceProvider>
      <Harness {...options} onStore={(next) => (store = next)} />
    </WorkspaceProvider>
  );
  return {
    ...rendered,
    get store() {
      return store;
    },
  };
}

async function waitUntilReady() {
  await waitFor(() => expect(adapter.ready).toHaveBeenCalledTimes(1));
}

async function send(raw) {
  act(() => adapter.handler(raw));
  await waitFor(() =>
    expect(adapter.responses.some((response) => response.requestId === raw.id)).toBe(true)
  );
  return adapter.responses.find((response) => response.requestId === raw.id);
}

beforeEach(() => {
  localStorage.clear();
  adapter.handler = null;
  adapter.order.length = 0;
  adapter.responses.length = 0;
  adapter.unlisten.mockClear();
  adapter.listen.mockClear();
  adapter.ready.mockClear();
  adapter.notReady.mockClear();
  adapter.respond.mockClear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("useAgentControlBridge", () => {
  it("installs the listener before ready and withdraws readiness on unmount", async () => {
    const view = mount();
    await waitUntilReady();
    expect(adapter.order.slice(0, 2)).toEqual(["listen", "ready"]);

    view.unmount();
    expect(adapter.unlisten).toHaveBeenCalledTimes(1);
    expect(adapter.notReady).toHaveBeenCalledTimes(1);
  });

  it("attaches one listener when StrictMode re-runs the effect mid-installation", async () => {
    // StrictMode tears the first effect run down and starts a second on the same component, so
    // both runs share every ref. The first run's listener resolves after the second has already
    // reset the shared liveness flag, and it must still withdraw itself — leaving it attached
    // delivered every request twice, which silently ran a non-idempotent command such as
    // `preset save` two times while reporting one result.
    const installs = [];
    const deferred = (handler) =>
      new Promise((resolve) => {
        const stop = vi.fn();
        installs.push({ handler, stop, settle: () => resolve(stop) });
      });
    adapter.listen.mockImplementationOnce(deferred).mockImplementationOnce(deferred);

    render(
      <StrictMode>
        <WorkspaceProvider>
          <Harness onStore={() => {}} />
        </WorkspaceProvider>
      </StrictMode>
    );
    await waitFor(() => expect(installs).toHaveLength(2));

    installs[0].settle();
    installs[1].settle();

    await waitFor(() => expect(installs[0].stop).toHaveBeenCalledTimes(1));
    expect(installs[1].stop).not.toHaveBeenCalled();
    // Only the surviving run announces readiness.
    await waitFor(() => expect(adapter.ready).toHaveBeenCalledTimes(1));
  });

  it("does not mount for an unavailable runtime or an accessory surface", async () => {
    mount({ enabled: false });
    await Promise.resolve();
    expect(adapter.listen).not.toHaveBeenCalled();
    expect(adapter.ready).not.toHaveBeenCalled();
  });

  it("keeps capabilities independent from the latest inspect revision", async () => {
    const view = mount();
    await waitUntilReady();
    const initialTree = view.store.state.tree;

    const capabilities = await send(request("app.capabilities", {}, "cap"));
    expect(capabilities.result).toMatchObject({ protocolVersion: 1 });
    expect(capabilities.result).not.toHaveProperty("revision");
    const first = await send(request("app.inspect", {}, "inspect-1"));
    expect(first.result.revisions.workspace).toBe(0);
    expect(first.result.revisions.presets).toBe(0);
    expect(first.result).not.toHaveProperty("revision");
    expect(view.store.state.tree).toBe(initialTree);

    act(() => view.store.setTree({ type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" }));
    const second = await send(request("app.inspect", {}, "inspect-2"));
    expect(second.result.revisions.workspace).toBe(1);
    expect(second.result.workspace.layout).toEqual({ type: "panel", panelId: "spectrum" });
  });

  it("lists and describes saved Presets through public shapes", async () => {
    const stored = {
      id: "preset-1",
      name: "Mixing",
      ...DEFAULT_WORKSPACE_STATE,
      loudnessProfileActive: "off",
    };
    mount({
      presets: { list: [stored], activeId: "preset-1", dirty: true },
    });
    await waitUntilReady();

    const listed = await send(request("preset.list", {}, "preset-list"));
    const described = await send(
      request("preset.describe", { presetId: "preset-1" }, "preset-describe")
    );

    expect(listed.result).toEqual({
      revision: 0,
      presets: [{ id: "preset-1", name: "Mixing" }],
      activeId: "preset-1",
      dirty: true,
    });
    expect(described.result).toMatchObject({
      revision: 0,
      preset: {
        id: "preset-1",
        name: "Mixing",
        workspace: { layout: expect.any(Object), panels: expect.any(Array) },
        window: { bounds: null },
        loudnessProfile: { activeId: null },
      },
    });
  });

  it("inspects and describes focused Settings with an independent revision", async () => {
    mount();
    await waitUntilReady();

    const inspected = await send(request("settings.inspect", {}, "settings-inspect"));
    const described = await send(request("settings.describe", {}, "settings-describe"));

    expect(inspected.result).toMatchObject({
      revision: 0,
      settings: publicSettings,
      availability: { openAtLogin: { writable: true, reason: null } },
    });
    expect(inspected.result).not.toHaveProperty("schema");
    expect(described.result).toMatchObject({
      revision: 0,
      settings: publicSettings,
      schema: {
        historyRetentionSec: { type: "enum", current: 3600, unit: "s" },
      },
    });
  });

  it("inspects the focused Transport lifecycle", async () => {
    mount();
    await waitUntilReady();
    const response = await send(request("transport.inspect", {}, "transport-inspect"));
    expect(response.result).toEqual({ revision: 0, ...transport });
  });

  it("inspects and describes Dock against the Workspace revision", async () => {
    mount();
    await waitUntilReady();
    const inspected = await send(request("dock.inspect", {}, "dock-inspect"));
    const described = await send(request("dock.describe", {}, "dock-describe"));
    expect(inspected.result).toMatchObject({
      revision: 0,
      presetsRevision: 0,
      supported: true,
      enabled: false,
      panels: [{ id: "transport", moduleId: "transport" }],
    });
    expect(described.result).toMatchObject({
      revision: 0,
      supported: true,
      height: { min: 56, max: 160 },
    });
  });

  it("preserves the monitorNotFound reason from Dock validation", async () => {
    mount({
      agentDockContext: {
        monitors: [{ id: "monitor-1", name: "Display 1" }],
        monitorInventoryReady: true,
      },
    });
    await waitUntilReady();

    const response = await send(
      request("dock.enter", { monitor: "missing" }, "dock-monitor-missing")
    );

    expect(response.error).toMatchObject({
      data: {
        reason: "monitorNotFound",
        details: { issues: [expect.objectContaining({ code: "monitorNotFound" })] },
      },
    });
  });

  it("atomically replaces the Dock layout and settles on Workspace revision", async () => {
    mount();
    await waitUntilReady();
    const response = await send(
      request(
        "dock.layout.apply",
        { layout: { panels: [{ key: "meter", moduleId: "levelMeter", controls: {} }] } },
        "dock-layout"
      )
    );
    expect(response.result).toMatchObject({
      revision: 1,
      dryRun: false,
      changed: ["dock.panels"],
      createdPanels: { meter: "levelMeter" },
      dock: { panels: [{ id: "levelMeter", moduleId: "levelMeter" }] },
    });
  });

  it("reports the observable Dock state when native execution fails", async () => {
    mount({ executeAgentDock: vi.fn(async () => Promise.reject(new Error("native refused"))) });
    await waitUntilReady();

    const response = await send(request("dock.enter", {}, "dock-native-failure"));

    expect(response.error).toMatchObject({
      code: -32050,
      data: {
        reason: "applicationFailed",
        details: {
          stage: "execution",
          partial: false,
          changed: ["dock.enabled"],
          revision: 0,
          dock: { enabled: false },
        },
      },
    });
  });

  it("reports a committed Dock mutation when persistence fails", async () => {
    const flush = vi.fn(async () => Promise.reject(new Error("disk full")));
    mount({ flush });
    await waitUntilReady();

    const response = await send(
      request(
        "dock.layout.apply",
        { layout: { panels: [{ key: "meter", moduleId: "levelMeter", controls: {} }] } },
        "dock-persistence-failure"
      )
    );

    expect(response.error).toMatchObject({
      code: -32030,
      data: {
        reason: "persistenceFailed",
        details: {
          stage: "persistence",
          partial: true,
          changed: ["dock.panels"],
          revision: 1,
          dock: { panels: [{ id: "levelMeter" }] },
        },
      },
    });
  });

  it("applies a Transport source mutation and settles on its revision", async () => {
    mount();
    await waitUntilReady();

    const response = await send(
      request("transport.source.file", { expectedRevision: 0 }, "transport-source-file")
    );

    expect(response.result).toMatchObject({
      dryRun: false,
      revision: 1,
      changed: ["transport.source"],
      effects: [],
      warnings: [],
      source: "file",
    });
  });

  it("does not execute a Transport dry-run", async () => {
    const executeTransport = vi.fn(async () => {});
    mount({ executeAgentTransport: executeTransport });
    await waitUntilReady();

    const response = await send(
      request("transport.live.start", { dryRun: true }, "transport-start-dry")
    );

    expect(response.result).toMatchObject({
      dryRun: true,
      revision: 0,
      changed: ["transport.live.state"],
      source: "live",
      live: { state: "stopped" },
    });
    expect(executeTransport).not.toHaveBeenCalled();
  });

  it("rejects stale Transport mutations before execution", async () => {
    const executeTransport = vi.fn(async () => {});
    mount({ executeAgentTransport: executeTransport });
    await waitUntilReady();

    const response = await send(
      request("transport.live.stop", { expectedRevision: 3 }, "transport-conflict")
    );

    expect(response.error).toMatchObject({
      code: -32004,
      data: {
        reason: "revisionConflict",
        path: "$.params.expectedRevision",
        details: { expectedRevision: 3, currentRevision: 0 },
      },
    });
    expect(executeTransport).not.toHaveBeenCalled();
  });

  it("updates Settings atomically and reports its independent revision", async () => {
    const flush = vi.fn(async () => {});
    mount({ flush });
    await waitUntilReady();

    const response = await send(
      request(
        "settings.update",
        {
          patch: { closeBehavior: "tray", interfaceSize: "large" },
          expectedRevision: 0,
        },
        "settings-update"
      )
    );

    expect(response.result).toMatchObject({
      dryRun: false,
      revision: 1,
      changed: ["settings.closeBehavior", "settings.interfaceSize"],
      settings: { closeBehavior: "tray", interfaceSize: "large" },
      effects: [],
      warnings: [],
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("previews a required Settings restart without demanding confirmation", async () => {
    mount({
      agentSettingsContext: { ...settingsContext, dialogueDetectionActive: true },
    });
    await waitUntilReady();

    const response = await send(
      request(
        "settings.update",
        { patch: { dialogueVadEngine: "silero" }, dryRun: true },
        "settings-restart-dry"
      )
    );

    expect(response.result).toMatchObject({
      dryRun: true,
      revision: 0,
      effects: ["measurementRestart"],
      confirmation: { requiredFlag: "allowMeasurementRestart" },
      settings: { dialogueVadEngine: "silero" },
    });
  });

  it("does not count initial Settings capability hydration as a revision", async () => {
    const view = mount({
      agentSettingsContext: {
        ...settingsContext,
        autostartReady: false,
        clearShortcutReady: false,
      },
    });
    await waitUntilReady();
    view.rerender(
      <WorkspaceProvider>
        <Harness
          agentSettings={{ ...publicSettings, openAtLogin: true }}
          agentSettingsContext={{
            ...settingsContext,
            autostartReady: true,
            clearShortcutReady: true,
          }}
          controlledAgentSettings
        />
      </WorkspaceProvider>
    );
    const inspected = await send(request("settings.inspect", {}, "settings-hydrated"));
    expect(inspected.result.revision).toBe(0);
  });

  it("waits outside the command queue until the global revision changes", async () => {
    const view = mount();
    await waitUntilReady();
    const waitRequest = request("app.wait", { afterRevision: 0, timeoutMs: 1000 }, "wait-change");
    act(() => adapter.handler(waitRequest));

    const inspected = await send(request("app.inspect", {}, "inspect-during-wait"));
    expect(inspected.result.revisions.workspace).toBe(0);
    act(() => view.store.setTree({ type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" }));
    await waitFor(() =>
      expect(adapter.responses.some(({ requestId }) => requestId === "wait-change")).toBe(true)
    );
    expect(adapter.responses.find(({ requestId }) => requestId === "wait-change").result).toEqual({
      outcome: "changed",
      matchedImmediately: false,
      revision: 1,
    });
  });

  it("releases a revision waiter immediately when its client disconnects", async () => {
    mount();
    await waitUntilReady();
    act(() => adapter.handler(request("app.wait", { afterRevision: 0, timeoutMs: 100 }, "gone")));
    act(() => adapter.handler({ type: "cancel", requestId: "gone" }));

    for (let index = 0; index < 4; index += 1) {
      act(() =>
        adapter.handler(
          request("app.wait", { afterRevision: 0, timeoutMs: 100 }, `remaining-${index}`)
        )
      );
    }

    await waitFor(() =>
      expect(
        adapter.responses.filter(({ requestId }) => requestId.startsWith("remaining-"))
      ).toHaveLength(4)
    );
    expect(adapter.responses.find(({ requestId }) => requestId === "gone")).toBeUndefined();
    expect(
      adapter.responses.filter(({ requestId }) => requestId.startsWith("remaining-"))
    ).toSatisfy((responses) => responses.every(({ error }) => error?.data?.reason === "timeout"));
  });

  it("returns a timeout error with the current global revision", async () => {
    mount();
    await waitUntilReady();
    const response = await send(
      request("app.wait", { afterRevision: 0, timeoutMs: 100 }, "wait-timeout")
    );
    expect(response.error).toMatchObject({
      code: -32071,
      data: {
        reason: "timeout",
        details: { afterRevision: 0, currentRevision: 0 },
      },
    });
  });

  it("returns stable Preset missing-target errors", async () => {
    mount();
    await waitUntilReady();

    const missing = await send(
      request("preset.describe", { presetId: "missing" }, "preset-missing")
    );

    expect(missing.error).toMatchObject({
      code: -32020,
      data: { reason: "presetNotFound", path: "$.params.presetId" },
    });
  });

  it("renames, reorders, and deletes Presets with revision and persistence settlement", async () => {
    const flush = vi.fn(async () => {});
    const first = { id: "preset-1", name: "Mixing" };
    const second = { id: "preset-2", name: "Mastering" };
    mount({
      flush,
      presets: { list: [first, second], activeId: "preset-1", dirty: true },
    });
    await waitUntilReady();

    const renamed = await send(
      request(
        "preset.rename",
        { presetId: "preset-1", name: "  Final Mix  ", expectedRevision: 0 },
        "preset-rename"
      )
    );
    const reorderDryRun = await send(
      request(
        "preset.reorder",
        { presetIds: ["preset-2", "preset-1"], dryRun: true, expectedRevision: 1 },
        "preset-reorder-dry"
      )
    );
    const deleted = await send(
      request("preset.delete", { presetId: "preset-1", expectedRevision: 1 }, "preset-delete")
    );
    const listed = await send(request("preset.list", {}, "preset-list-after-delete"));

    expect(renamed.result).toMatchObject({
      dryRun: false,
      changed: ["presets.preset-1.name"],
      preset: { id: "preset-1", name: "Final Mix" },
      presetState: { activeId: "preset-1", dirty: true },
      revisions: { workspace: 0, presets: 1 },
      warnings: [],
    });
    expect(reorderDryRun.result).toMatchObject({
      dryRun: true,
      changed: ["presets.order"],
      presetIds: ["preset-2", "preset-1"],
      revisions: { workspace: 0, presets: 1 },
    });
    expect(deleted.result).toMatchObject({
      deletedPreset: { id: "preset-1", name: "Final Mix" },
      changed: ["presets.library", "presets.activeId", "presets.dirty"],
      presetState: { activeId: null, dirty: false },
      revisions: { workspace: 0, presets: 2 },
    });
    expect(listed.result.presets).toEqual([{ id: "preset-2", name: "Mastering" }]);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("keeps invalid and no-op Preset library mutations side-effect free", async () => {
    const flush = vi.fn(async () => {});
    mount({
      flush,
      presets: { list: [{ id: "preset-1", name: "Mixing" }], activeId: null, dirty: false },
    });
    await waitUntilReady();

    const noOp = await send(
      request("preset.rename", { presetId: "preset-1", name: " Mixing " }, "preset-rename-noop")
    );
    const invalid = await send(
      request("preset.reorder", { presetIds: ["missing"] }, "preset-reorder-invalid")
    );

    expect(noOp.result).toMatchObject({ changed: [], revisions: { workspace: 0, presets: 0 } });
    expect(invalid.error).toMatchObject({
      code: -32602,
      data: {
        reason: "invalidPreset",
        details: { issues: [expect.objectContaining({ code: "invalidPermutation" })] },
      },
    });
    expect(flush).not.toHaveBeenCalled();
  });

  it("saves a captured scene and previews an update without allocating or persisting", async () => {
    const flush = vi.fn(async () => {});
    const snapshot = { tree: { type: "leaf", tabs: [] }, windowPinned: true };
    mount({
      flush,
      capturePresetSnapshot: vi.fn(async () => snapshot),
      presets: { list: [], activeId: null, dirty: false },
    });
    await waitUntilReady();

    const saved = await send(
      request(
        "preset.save",
        {
          name: "  New Mix  ",
          expectedRevision: 0,
          expectedRevision: 0,
        },
        "preset-save"
      )
    );
    const updateDryRun = await send(
      request(
        "preset.update",
        {
          presetId: "preset-new",
          expectedRevision: 0,
          expectedRevision: 1,
          dryRun: true,
        },
        "preset-update-dry"
      )
    );

    expect(saved.result).toMatchObject({
      dryRun: false,
      changed: ["presets.library", "presets.activeId"],
      preset: { id: "preset-new", name: "New Mix" },
      presetState: { activeId: "preset-new", dirty: false },
      revisions: { workspace: 0, presets: 1 },
    });
    expect(updateDryRun.result).toMatchObject({
      dryRun: true,
      changed: [],
      preset: { id: "preset-new", name: "New Mix" },
      revisions: { workspace: 0, presets: 1 },
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("preserves structured blocking-editor refusals for Preset capture", async () => {
    const flush = vi.fn(async () => {});
    mount({
      flush,
      assertPresetOperationAllowed: (operation) => {
        throw new SceneOperationBlockedError(operation, ["theme"]);
      },
      presets: { list: [], activeId: null, dirty: false },
    });
    await waitUntilReady();

    const response = await send(request("preset.save", { name: "Blocked" }, "preset-save-blocked"));

    expect(response.error).toMatchObject({
      code: -32040,
      data: {
        reason: "editorActive",
        details: { operation: "preset.save", editors: ["theme"] },
      },
    });
    expect(flush).not.toHaveBeenCalled();
  });

  it("fails one command instead of the channel when a commit is never observed", async () => {
    // A settlement predicate that never matches used to hang forever, and because commands share
    // one serialized queue every later command hung behind it - the control channel was dead until
    // the app restarted. The backstop turns that into a single stated failure.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // Resolves without ever moving Dock state, so the settlement can never match.
      mount({ executeAgentDock: vi.fn(async () => {}) });
      await vi.waitFor(() => expect(adapter.ready).toHaveBeenCalledTimes(1));

      act(() => adapter.handler(request("dock.enter", { edge: "top" }, "dock-stuck")));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6000);
      });

      const response = adapter.responses.find(({ requestId }) => requestId === "dock-stuck");
      expect(response?.error).toMatchObject({
        code: -32031,
        data: { reason: "commitNotObserved", details: { stateCommitted: true } },
      });

      // The queue moved on rather than staying blocked behind it.
      act(() => adapter.handler(request("app.inspect", {}, "after-stuck")));
      await vi.waitFor(() =>
        expect(adapter.responses.some(({ requestId }) => requestId === "after-stuck")).toBe(true)
      );
      const after = adapter.responses.find(({ requestId }) => requestId === "after-stuck");
      expect(after.error).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies a Preset whose stored controls no longer match the migrated Workspace", async () => {
    // A Preset saved before a control existed stores a different `panelControlsById` than the one
    // applying it produces, because applying migrates. Waiting for the live Workspace to equal the
    // *stored* record therefore never settled, and since commands share one serialized queue that
    // hung every later command until the app restarted.
    const flush = vi.fn(async () => {});
    const stale = {
      id: "preset-1",
      name: "Saved Long Ago",
      ...DEFAULT_WORKSPACE_STATE,
      panelControlsById: { spectrum: { spectrumSpeedPercent: 40, removedLegacyControl: 7 } },
    };
    // The Preset really does differ from what applying it yields, or the test proves nothing.
    expect(JSON.stringify(presetWorkspaceView(stale).panelControlsById)).not.toBe(
      JSON.stringify(stale.panelControlsById)
    );

    const view = mount({
      flush,
      applyPresetToWorkspace: true,
      capturePresetSnapshot: vi.fn(async () => ({
        ...DEFAULT_WORKSPACE_STATE,
        windowPinned: false,
      })),
      presets: { list: [stale], activeId: null, dirty: false },
    });
    await waitUntilReady();

    const response = await send(request("preset.apply", { presetId: "preset-1" }, "preset-stale"));

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({ dryRun: false, preset: { id: "preset-1" } });
    expect(flush).toHaveBeenCalled();

    // The channel is still usable: a hung settlement used to block everything behind it.
    const after = await send(request("app.inspect", {}, "after-stale-apply"));
    expect(after.error).toBeUndefined();
    expect(view.store.state.panelControlsById.spectrum.spectrumSpeedPercent).toBe(40);
  });

  it("applies a matching Preset by associating it without replacing the Workspace", async () => {
    const flush = vi.fn(async () => {});
    const snapshot = { tree: { type: "leaf", tabs: [] }, windowPinned: true };
    mount({
      flush,
      capturePresetSnapshot: vi.fn(async () => snapshot),
      presets: {
        list: [{ id: "preset-1", name: "Mix", ...snapshot }],
        activeId: null,
        dirty: false,
      },
    });
    await waitUntilReady();

    const response = await send(
      request(
        "preset.apply",
        {
          presetId: "preset-1",
          expectedRevision: 0,
          expectedRevision: 0,
        },
        "preset-apply"
      )
    );

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      dryRun: false,
      changed: ["presets.activeId"],
      preset: { id: "preset-1", name: "Mix" },
      presetState: { activeId: "preset-1", dirty: false },
      revisions: { workspace: 0, presets: 1 },
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("previews Preset resource fallbacks", async () => {
    const target = {
      id: "preset-1",
      name: "Mix",
      tree: { type: "leaf", tabs: [] },
      windowPinned: true,
      loudnessProfileActive: "profile:deleted",
      dock: { enabled: true, monitor: "missing-monitor" },
    };
    mount({
      capturePresetSnapshot: vi.fn(async () => ({ tree: target.tree, windowPinned: true })),
      presets: { list: [target], activeId: null, dirty: false },
      agentDockContext: {
        monitors: [{ id: "monitor-1", name: "Display 1" }],
        fallbackMonitor: "monitor-1",
        monitorInventoryReady: true,
      },
    });
    await waitUntilReady();

    const response = await send(
      request("preset.apply", { presetId: "preset-1", dryRun: true }, "preset-fallback-dry")
    );

    expect(response.result.warnings).toEqual([
      { code: "loudnessProfileUnavailable", requested: "deleted", effective: null },
      { code: "dockMonitorUnavailable", requested: "missing-monitor", effective: "monitor-1" },
    ]);
  });

  it("does not advance the public revision for transient fullscreen state", async () => {
    const view = mount();
    await waitUntilReady();

    act(() => view.store.setFullscreen("spectrum"));
    const inspected = await send(request("app.inspect", {}, "inspect-fullscreen"));

    expect(inspected.result.revisions.workspace).toBe(0);
  });

  it("reports Loudness reference availability from the active Profile", async () => {
    mount({ hasLoudnessReference: true });
    await waitUntilReady();

    const inspected = await send(request("app.inspect", {}, "inspect-reference"));
    const loudness = inspected.result.workspace.panels.find(({ id }) => id === "loudness");

    expect(loudness.controls.layers).toEqual(["momentary", "shortTerm", "reference"]);
  });

  it("reports panel analysis against the current channel topology", async () => {
    const view = mount({ analysisContext: { channelCount: 4 } });
    await waitUntilReady();
    act(() => {
      view.store.setPanelControlsForPanel("spectrum", {
        ...view.store.state.panelControlsById.spectrum,
        spectrumChannel: { type: "pair", x: 0, y: 3 },
      });
    });

    const inspected = await send(request("app.inspect", {}, "inspect-analysis"));
    const spectrum = inspected.result.workspace.panels.find(({ id }) => id === "spectrum");

    expect(spectrum.analysis).toEqual({ status: "active" });
  });

  it("describes one live panel with its dynamic public control schema", async () => {
    mount({ analysisContext: { channelCount: 6 }, hasLoudnessReference: false });
    await waitUntilReady();

    const response = await send(
      request("panel.describe", { panelId: "loudness" }, "describe-panel")
    );

    expect(response.result).toMatchObject({
      revision: 0,
      panel: {
        id: "loudness",
        moduleId: "loudness",
        controls: { layers: ["momentary", "shortTerm"] },
      },
      schema: {
        type: "object",
        patchMode: "merge",
        properties: {
          layers: { options: ["momentary", "shortTerm"] },
        },
      },
    });
  });

  it("returns panelNotFound when describing an unknown panel", async () => {
    mount();
    await waitUntilReady();

    const response = await send(
      request("panel.describe", { panelId: "missing" }, "describe-missing")
    );

    expect(response.error).toMatchObject({
      code: -32010,
      data: { reason: "panelNotFound", path: "$.params.panelId" },
    });
  });

  it("describes and inspects Axis Control without mutating Workspace state", async () => {
    const view = mount({
      analysisContext: { timeMaxWindowSec: 3600, timeMaxOffsetSec: 3540 },
    });
    await waitUntilReady();
    const initialState = view.store.state;

    const described = await send(request("axis.describe", {}, "axis-describe"));
    const inspected = await send(request("axis.inspect", {}, "axis-inspect"));

    expect(described.result).toMatchObject({
      revision: 0,
      schema: {
        time: { properties: { windowSec: { maximum: 3600 } } },
      },
      shared: { frequency: { minHz: 20, maxHz: 20000 } },
    });
    expect(inspected.result).toMatchObject({
      revision: 0,
      shared: { time: { windowSec: 60, offsetSec: 0 } },
      panels: expect.any(Array),
    });
    expect(inspected.result).not.toHaveProperty("schema");
    expect(view.store.state).toBe(initialState);
  });

  it("updates a shared axis as one durable Workspace mutation", async () => {
    const flush = vi.fn(async () => {});
    const presets = { activeId: "preset-1", dirty: false };
    const view = mount({ flush, presets });
    await waitUntilReady();

    const response = await send(
      request(
        "axis.shared.update",
        {
          kind: "frequency",
          range: { minHz: 200, maxHz: 5000 },
          expectedRevision: 0,
        },
        "axis-shared-update"
      )
    );

    expect(response.result).toMatchObject({
      dryRun: false,
      revision: 1,
      changed: ["shared.frequency.minHz", "shared.frequency.maxHz"],
      warnings: [],
      axis: { shared: { frequency: { minHz: 200, maxHz: 5000 } } },
      preset: { activeId: "preset-1", dirty: true },
    });
    expect(response.result).not.toHaveProperty("persisted");
    expect(view.store.state.axisViewports.frequency).toEqual({ min: 200, max: 5000 });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("dry-runs a panel unlink and rejects a linked local range atomically", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;

    const dryRun = await send(
      request(
        "axis.panel.update",
        {
          panelId: "spectrum",
          kind: "frequency",
          patch: { linked: false, range: { minHz: 200, maxHz: 5000 } },
          dryRun: true,
        },
        "axis-panel-dry"
      )
    );
    const invalid = await send(
      request(
        "axis.panel.update",
        {
          panelId: "spectrum",
          kind: "frequency",
          patch: { range: { minHz: 200, maxHz: 5000 } },
        },
        "axis-panel-invalid"
      )
    );

    expect(dryRun.result).toMatchObject({
      dryRun: true,
      revision: 0,
      changed: expect.arrayContaining(["panels.spectrum.frequency.linked"]),
      axis: {
        panels: expect.arrayContaining([
          expect.objectContaining({
            id: "spectrum",
            axes: expect.objectContaining({
              frequency: expect.objectContaining({ linked: false }),
            }),
          }),
        ]),
      },
    });
    expect(invalid.error).toMatchObject({
      code: -32602,
      data: {
        reason: "invalidAxis",
        details: { issues: [expect.objectContaining({ code: "rangeWhileLinked" })] },
      },
    });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("resets panel and shared axes and returns stable target errors", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    act(() => {
      view.store.replaceWorkspace({
        ...view.store.state,
        axisViewports: {
          ...view.store.state.axisViewports,
          frequency: { min: 200, max: 5000 },
        },
        panelControlsById: {
          ...view.store.state.panelControlsById,
          spectrum: {
            ...view.store.state.panelControlsById.spectrum,
            linkFrequencyViewport: false,
            spectrumXMinFreq: 1000,
            spectrumXMaxFreq: 8000,
          },
        },
      });
    });
    flush.mockClear();

    const panelReset = await send(
      request(
        "axis.panel.reset",
        { panelId: "spectrum", kind: "frequency", expectedRevision: 1 },
        "axis-panel-reset"
      )
    );
    const sharedReset = await send(
      request("axis.shared.reset", { kind: "frequency", expectedRevision: 2 }, "axis-shared-reset")
    );
    const unavailable = await send(
      request(
        "axis.panel.reset",
        { panelId: "levelMeter", kind: "frequency", expectedRevision: 3 },
        "axis-unavailable"
      )
    );

    expect(panelReset.result.changed).toContain("panels.spectrum.frequency.linked");
    expect(sharedReset.result.axis.shared.frequency).toEqual({ minHz: 20, maxHz: 20000 });
    expect(unavailable.error).toMatchObject({
      code: -32012,
      data: { reason: "axisUnavailable", path: "$.params.kind" },
    });
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("returns one structured error for invalid or unsupported requests", async () => {
    mount();
    await waitUntilReady();
    const response = await send(request("unknown.method", {}, "bad"));
    expect(response).toEqual({
      requestId: "bad",
      error: expect.objectContaining({
        code: -32601,
        data: expect.objectContaining({ reason: "methodNotFound" }),
      }),
    });
    expect(adapter.respond).toHaveBeenCalledTimes(1);
  });

  it("dry-runs with planned IDs without mutation or persistence", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;
    const response = await send(
      request(
        "workspace.applyLayout",
        {
          dryRun: true,
          expectedRevision: 0,
          layout: { type: "panel", key: "map", moduleId: "stereo-map" },
        },
        "dry"
      )
    );

    expect(response.result).toMatchObject({
      revision: 0,
      dryRun: true,
      persisted: false,
      createdPanels: { map: "stereo-map" },
    });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("updates panel controls atomically and returns the complete persisted panel", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();

    const response = await send(
      request(
        "panel.update",
        {
          panelId: "levelMeter",
          expectedRevision: 0,
          patch: { mode: "rms", playbackMax: true },
        },
        "panel-update"
      )
    );

    expect(response.result).toMatchObject({
      dryRun: false,
      revision: 1,
      changed: ["controls.mode", "controls.playbackMax"],
      warnings: [],
      panel: {
        id: "levelMeter",
        moduleId: "levelMeter",
        controls: { mode: "rms", playbackMax: true },
      },
      preset: { activeId: null, dirty: false },
    });
    expect(response.result).not.toHaveProperty("persisted");
    expect(view.store.state.panelControlsById.levelMeter).toMatchObject({
      levelMeterMode: "rms",
      levelMeterPlaybackMax: true,
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("dry-runs a panel update without changing revision, state, or persistence", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;

    const response = await send(
      request(
        "panel.update",
        { panelId: "levelMeter", dryRun: true, patch: { mode: "rms" } },
        "panel-dry"
      )
    );

    expect(response.result).toMatchObject({
      dryRun: true,
      revision: 0,
      changed: ["controls.mode"],
      panel: { controls: { mode: "rms" } },
    });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("returns all panel validation issues without partial mutation", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialControls = view.store.state.panelControlsById.levelMeter;

    const response = await send(
      request(
        "panel.update",
        {
          panelId: "levelMeter",
          patch: { unknown: true, mode: "vu", playbackMax: "yes" },
        },
        "panel-invalid"
      )
    );

    expect(response.error).toMatchObject({
      data: {
        reason: "invalidControls",
        path: "$.params.patch",
        details: {
          issues: [
            expect.objectContaining({ code: "unknownControl", path: "$.unknown" }),
            expect.objectContaining({ code: "invalidEnum", path: "$.mode" }),
            expect.objectContaining({ code: "invalidType", path: "$.playbackMax" }),
          ],
        },
      },
    });
    expect(view.store.state.panelControlsById.levelMeter).toBe(initialControls);
    expect(flush).not.toHaveBeenCalled();
  });

  it("keeps a no-op panel update clean and marks an effective update dirty", async () => {
    const flush = vi.fn(async () => {});
    const presets = { activeId: "preset-1", dirty: false };
    const view = mount({ flush, presets });
    await waitUntilReady();
    const initialState = view.store.state;

    const noOp = await send(
      request("panel.update", { panelId: "levelMeter", patch: { mode: "peak" } }, "panel-no-op")
    );
    expect(noOp.result).toMatchObject({
      revision: 0,
      changed: [],
      preset: { activeId: "preset-1", dirty: false },
    });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();

    const changed = await send(
      request("panel.update", { panelId: "levelMeter", patch: { mode: "rms" } }, "panel-dirty")
    );
    expect(changed.result.preset).toEqual({ activeId: "preset-1", dirty: true });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("reports a panel persistence failure with the committed revision", async () => {
    const flush = vi.fn(async () => {
      throw new Error("disk full");
    });
    const view = mount({ flush });
    await waitUntilReady();

    const response = await send(
      request("panel.update", { panelId: "levelMeter", patch: { mode: "rms" } }, "panel-flush")
    );

    expect(response.error).toMatchObject({
      code: -32030,
      data: {
        reason: "persistenceFailed",
        details: { stateCommitted: true, revision: 1 },
      },
    });
    expect(view.store.state.panelControlsById.levelMeter.levelMeterMode).toBe("rms");
  });

  it("resets panel controls and local axis state as one persisted Workspace mutation", async () => {
    const flush = vi.fn(async () => {});
    const presets = { activeId: "preset-1", dirty: false };
    const view = mount({ flush, presets });
    await waitUntilReady();
    act(() => {
      view.store.setPanelControlsForPanel("spectrum", {
        ...view.store.state.panelControlsById.spectrum,
        spectrumMaxMode: "hold",
        spectrumSpeedPercent: 80,
        linkFrequencyViewport: false,
        spectrumXMinFreq: 200,
        spectrumXMaxFreq: 5000,
      });
    });
    const revision = (await send(request("app.inspect", {}, "before-reset"))).result.revisions
      .workspace;
    flush.mockClear();

    const response = await send(
      request("panel.reset", { panelId: "spectrum", expectedRevision: revision }, "panel-reset")
    );

    expect(response.result).toMatchObject({
      dryRun: false,
      revision: revision + 1,
      changed: expect.arrayContaining([
        "controls.maxMode",
        "controls.speedPercent",
        "axes.frequency.linked",
      ]),
      warnings: [],
      panel: {
        id: "spectrum",
        moduleId: "spectrum",
        controls: { maxMode: "off", speedPercent: 25 },
        axes: { frequency: { linked: true } },
      },
      preset: { activeId: "preset-1", dirty: true },
    });
    expect(view.store.state.panelControlsById.spectrum).toMatchObject({
      spectrumMaxMode: "off",
      spectrumSpeedPercent: 25,
      linkFrequencyViewport: true,
      spectrumXMinFreq: 20,
      spectrumXMaxFreq: 20000,
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("dry-runs and no-ops panel resets without persistence", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;

    const noOp = await send(request("panel.reset", { panelId: "spectrum" }, "reset-no-op"));
    const dryRun = await send(
      request("panel.reset", { panelId: "levelMeter", dryRun: true }, "reset-dry")
    );

    expect(noOp.result).toMatchObject({ revision: 0, changed: [], dryRun: false });
    expect(dryRun.result).toMatchObject({ revision: 0, changed: [], dryRun: true });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("applies once, waits for commit and persistence, and returns the committed revision", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const response = await send(
      request(
        "workspace.applyLayout",
        {
          expectedRevision: 0,
          layout: { type: "panel", panelId: "spectrum" },
        },
        "apply"
      )
    );

    expect(response.result).toMatchObject({
      revision: 1,
      changed: ["workspace"],
      persisted: true,
      layout: { type: "panel", panelId: "spectrum" },
    });
    expect(view.store.state.tree).toEqual({
      type: "leaf",
      tabs: ["spectrum"],
      activeTab: "spectrum",
    });
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("does not commit or persist when applying the current layout", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    const initialState = view.store.state;
    const inspected = await send(request("app.inspect", {}, "inspect-current"));

    const response = await send(
      request(
        "workspace.applyLayout",
        { expectedRevision: 0, layout: inspected.result.workspace.layout },
        "apply-current"
      )
    );

    expect(response.result).toMatchObject({ revision: 0, changed: [] });
    expect(view.store.state).toBe(initialState);
    expect(flush).not.toHaveBeenCalled();
  });

  it("checks revision at the queue head before compiling or mutating", async () => {
    const flush = vi.fn(async () => {});
    const view = mount({ flush });
    await waitUntilReady();
    act(() => view.store.setTree({ type: "leaf", tabs: ["stats"], activeTab: "stats" }));

    const response = await send(
      request(
        "workspace.applyLayout",
        {
          expectedRevision: 0,
          layout: { type: "panel", key: "new", moduleId: "spectrum" },
        },
        "stale"
      )
    );

    expect(response.error).toMatchObject({
      code: -32004,
      data: expect.objectContaining({ reason: "revisionConflict" }),
    });
    expect(view.store.state.tree).toEqual({
      type: "leaf",
      tabs: ["stats"],
      activeTab: "stats",
    });
    expect(flush).not.toHaveBeenCalled();
  });

  it("reports the committed revision when persistence fails", async () => {
    const flush = vi.fn(async () => {
      throw new Error("disk full");
    });
    mount({ flush });
    await waitUntilReady();
    const response = await send(
      request(
        "workspace.applyLayout",
        { layout: { type: "panel", panelId: "spectrum" } },
        "failed-flush"
      )
    );
    expect(response.error).toMatchObject({
      code: -32030,
      data: {
        reason: "persistenceFailed",
        details: { stateCommitted: true, revision: 1 },
      },
    });
    expect(response).not.toHaveProperty("result");
  });

  it("serializes requests and never sends a late response after unmount", async () => {
    let releaseFlush;
    const flush = vi.fn(() => new Promise((resolve) => (releaseFlush = resolve)));
    const view = mount({ flush });
    await waitUntilReady();

    act(() => {
      adapter.handler(
        request(
          "workspace.applyLayout",
          { layout: { type: "panel", panelId: "spectrum" } },
          "first"
        )
      );
      adapter.handler(request("app.inspect", {}, "second"));
    });
    await waitFor(() => expect(releaseFlush).toBeTypeOf("function"));
    expect(adapter.responses).toHaveLength(0);

    view.unmount();
    releaseFlush();
    await Promise.resolve();
    await Promise.resolve();
    expect(adapter.responses).toHaveLength(0);
  });
});
