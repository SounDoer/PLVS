/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { WorkspaceProvider, useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { SceneOperationBlockedError } from "../lib/sceneOperations.js";
import { useAgentControlBridge } from "./useAgentControlBridge.js";

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

function request(method, params = {}, id = "req-1") {
  return { jsonrpc: "2.0", id, method, params };
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
  presets = { activeId: null, dirty: false },
  onStore = () => {},
}) {
  const store = useWorkspaceStore();
  const [presetState, setPresetState] = useState(presets);
  const [settingsState, setSettingsState] = useState(agentSettings);
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
      setPresetState((current) => ({ ...current, activeId: id, dirty: false }));
      return true;
    },
    preflightApplySnapshot: () => true,
  };
  onStore(store);
  useAgentControlBridge({
    enabled,
    runtime,
    workspace: store.state,
    replaceWorkspace: store.replaceWorkspace,
    setPanelControlsForPanel: store.setPanelControlsForPanel,
    waitForWorkspacePersistenceEnqueue: store.waitForWorkspacePersistenceEnqueue,
    presets: controlledPresets,
    settings: settingsState,
    settingsContext: agentSettingsContext,
    applySettings: async (next) => setSettingsState(next),
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
      request(
        "preset.describe",
        { presetId: "preset-1", expectedPresetsRevision: 0 },
        "preset-describe"
      )
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

  it("updates Settings atomically and reports its independent revision", async () => {
    const flush = vi.fn(async () => {});
    mount({ flush });
    await waitUntilReady();

    const response = await send(
      request(
        "settings.update",
        {
          patch: { closeBehavior: "tray", interfaceSize: "large" },
          expectedSettingsRevision: 0,
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

  it("returns stable Preset read conflicts and missing-target errors", async () => {
    mount();
    await waitUntilReady();

    const conflict = await send(
      request(
        "preset.describe",
        { presetId: "missing", expectedPresetsRevision: 1 },
        "preset-conflict"
      )
    );
    const missing = await send(
      request("preset.describe", { presetId: "missing" }, "preset-missing")
    );

    expect(conflict.error).toMatchObject({
      code: -32004,
      data: {
        reason: "revisionConflict",
        path: "$.params.expectedPresetsRevision",
        details: { expectedRevision: 1, currentRevision: 0 },
      },
    });
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
        { presetId: "preset-1", name: "  Final Mix  ", expectedPresetsRevision: 0 },
        "preset-rename"
      )
    );
    const reorderDryRun = await send(
      request(
        "preset.reorder",
        { presetIds: ["preset-2", "preset-1"], dryRun: true, expectedPresetsRevision: 1 },
        "preset-reorder-dry"
      )
    );
    const deleted = await send(
      request(
        "preset.delete",
        { presetId: "preset-1", expectedPresetsRevision: 1 },
        "preset-delete"
      )
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
          expectedWorkspaceRevision: 0,
          expectedPresetsRevision: 0,
        },
        "preset-save"
      )
    );
    const updateDryRun = await send(
      request(
        "preset.update",
        {
          presetId: "preset-new",
          expectedWorkspaceRevision: 0,
          expectedPresetsRevision: 1,
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
          expectedWorkspaceRevision: 0,
          expectedPresetsRevision: 0,
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
      request("axis.panel.reset", { panelId: "spectrum", kind: "frequency" }, "axis-panel-reset")
    );
    const sharedReset = await send(
      request("axis.shared.reset", { kind: "frequency" }, "axis-shared-reset")
    );
    const unavailable = await send(
      request("axis.panel.reset", { panelId: "levelMeter", kind: "frequency" }, "axis-unavailable")
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
