/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { createRevisionClock } from "./bridge/revisionClock.js";
import { createSettlementRegistry } from "./bridge/settlement.js";
import { createWaiters } from "./bridge/waiters.js";
import { transportHandlers } from "./handlers/transport.js";

const transport = vi.hoisted(() => ({
  lifecycle: "stopped",
  stop: vi.fn(),
  restore: vi.fn(),
  switchSource: vi.fn(),
  begin: vi.fn(),
  probe: vi.fn(),
}));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true, isLinux: () => false }));
vi.mock("../ipc/commands.js", async (importOriginal) => ({
  ...(await importOriginal()),
  probeFileAnalysis: transport.probe,
}));

const useAgentControlBridge = vi.hoisted(() => vi.fn());
vi.mock("./useAgentControlBridge.js", () => ({ useAgentControlBridge }));
vi.mock("../dev/useDevelopmentPerformance.js", () => ({
  useDevelopmentPerformance: (enabled) => ({ enabled, inspect: vi.fn(), stall: vi.fn() }),
}));
vi.mock("../dock/DockContext.jsx", () => ({
  useDock: () => ({
    docked: false,
    dockEdge: "bottom",
    dockMonitor: null,
    dockHeight: 72,
    dockSuspended: false,
    dockTransitioning: false,
    reserveSpace: false,
    layout: { panelsById: {}, panelOrder: [], panelSizesById: {}, controlsByPanelId: {} },
    executeDockForControl: async () => {},
  }),
}));
vi.mock("../hooks/WindowChromeContext.jsx", () => ({
  useWindowChrome: () => ({
    view: {
      pinned: false,
      focusView: { autoHideControls: false, compactPanels: false, borderless: false },
      surfaceOpacity: 100,
      glassEnabled: false,
    },
    applyViewState: async () => {},
  }),
}));
vi.mock("../hooks/PresetsContext.jsx", () => ({
  usePresetLibrary: () => ({ list: [], activeId: null, dirty: false }),
}));
vi.mock("../hooks/LoudnessProfileContext.jsx", () => ({
  useLoudnessProfile: () => ({ profiles: [], active: "off", referenceLufs: null }),
}));
vi.mock("../settings/SettingsContext.jsx", () => ({
  useAppSettings: () => ({
    customThemes: {},
    historyRetentionSec: 3600,
    channelLabelOverrides: {},
    autostartReady: true,
    shortcutsReady: true,
    shortcutCapturing: false,
    shortcutRegistrationErrors: {},
    keyboardShortcuts: {
      toggleLiveCapture: { accelerator: "CmdOrCtrl+1", global: false },
      toggleLiveSnapshot: { accelerator: "CmdOrCtrl+2", global: false },
      clear: { accelerator: "CmdOrCtrl+3", global: false },
    },
    applyKeyboardShortcutsForControl: async () => {},
    themeControl: { readState: () => ({ appearance: {}, themes: [] }) },
  }),
}));
vi.mock("../runtime/MeterRuntimeContext.jsx", () => ({
  useMeterRuntime: () => ({
    sourceMode: "live",
    liveLifecycle: transport.lifecycle,
    stopLiveForControl: transport.stop,
    restoreFileHistoryForControl: transport.restore,
    switchSource: transport.switchSource,
    beginFileAnalysisForControl: transport.begin,
    getLiveMeasurement: () => null,
    subscribeLiveMeasurement: () => () => {},
    running: false,
    liveDeviceTransition: null,
    fileSessions: [],
    activeFileId: null,
    analyzingFileId: null,
  }),
  useMeterDisplayState: () => ({
    selectedOffset: -1,
    selectSnapshot: () => {},
    clearSnapshot: () => {},
  }),
}));
vi.mock("../runtime/SourceContext.jsx", () => ({
  useSource: () => ({
    captureDeviceId: "default",
    snapshot: null,
    previewSelection: async () => {},
    commitCaptureDevice: async () => {},
  }),
}));
vi.mock("../runtime/SourceActionsContext.jsx", () => ({
  useSourceActions: () => ({
    currentFileAnalysisSettings: () => ({ dialogue: { enabled: false, engine: null } }),
    dialogueGating: false,
  }),
}));
vi.mock("../workspace/WorkspaceContext.jsx", () => ({
  useWorkspaceStore: () => ({
    state: {
      panelsById: {},
      panelOrder: [],
      axisViewports: { frequency: { min: 20, max: 20000 } },
    },
    replaceWorkspace: () => {},
    setPanelControlsForPanel: () => {},
    waitForWorkspacePersistenceEnqueue: async () => {},
  }),
}));
vi.mock("../runtime/AnalysisSessionContext.jsx", () => ({
  useAnalysisSession: () => ({
    channelCount: 2,
    channelLabelRuntime: {
      channelLabelOverride: null,
      channelRoles: null,
      channelLabelTokens: ["L", "R"],
      channelAutoLabels: ["L", "R"],
    },
    derivedAnalysisRequests: { spectralWaveform: false },
    analysisRequests: { vectorscope: [] },
    fileDurationMs: undefined,
    setChannelRolesForControl: async () => {},
    setDialogueVadEngineForControl: async () => {},
  }),
}));
vi.mock("./settingsControl.js", () => ({
  buildPublicSettings: (_settings, context) => ({ fromContext: context.channelCount }),
}));
vi.mock("../runtime/DisplaySnapshotContext.jsx", () => ({
  useDisplaySnapshot: () => ({ histSourceList: [{ timestampMs: 0 }, { timestampMs: 90_000 }] }),
}));
vi.mock("../hooks/SceneGuardContext.jsx", () => ({
  useSceneGuard: () => ({ activeBlockingEditors: [] }),
}));
vi.mock("./AgentControlStateContext.jsx", () => ({
  useAgentControlState: () => ({
    runtime: { available: true, platform: "x" },
    enabled: true,
    platformCapabilities: { platform: "x" },
    setRecordingState: () => {},
  }),
}));
vi.mock("../dock/DockAccessoriesContext.jsx", () => ({
  useDockAccessories: () => ({ visualRuntimeRef: { current: { windowForm: "normal" } } }),
}));
vi.mock("./useVisualCaptureSurfaces.js", () => ({
  useVisualCaptureSurfaces: () => ({ settle: async () => "surface", subscribe: () => () => {} }),
}));
vi.mock("../lib/runtimeRole.js", () => ({ isParticipantInstance: () => false }));
vi.mock("../hooks/AppLifecycleContext.jsx", () => ({
  useAppLifecycle: () => ({
    updateBusy: false,
    updateControls: { openDetails: () => {}, confirmInstall: () => {} },
    crashReportSetting: { enabled: true, setEnabled: async () => {} },
    requestCloseAction: async () => true,
  }),
}));
vi.mock("../uiNavigation/UiNavigationContext.jsx", () => ({
  useUiNavigation: () => ({ inspectUi: () => ({}) }),
}));
vi.mock("../dev/DevelopmentEventFixturesContext.jsx", () => ({
  useDevelopmentEventFixtures: () => ({ enabled: false }),
}));
vi.mock("./EditorDraftContext.jsx", () => ({
  useEditorDraftRegistry: () => ({ inspect: () => null }),
}));

import { AgentControlBridge } from "./AgentControlBridge.jsx";

describe("AgentControlBridge", () => {
  it("renders nothing and builds every area from its owner", async () => {
    const { container } = render(<AgentControlBridge />);

    expect(container.innerHTML).toBe("");
    const passed = useAgentControlBridge.mock.calls.at(-1)[0];
    expect(passed.enabled).toBe(true);
    expect(passed.runtime).toEqual({ available: true, platform: "x" });
    expect(typeof passed.editorDraft.inspect).toBe("function");
    expect(passed.visual.platformCapabilities).toEqual({ platform: "x" });
    expect(passed.visual.getRuntime()).toEqual({ windowForm: "normal" });
    await expect(passed.visual.settle({ kind: "panel" }, {})).resolves.toBe("surface");
    expect(passed.dock).toMatchObject({ enabled: false, edge: "bottom", height: 72 });
    expect(passed.dockContext).toMatchObject({
      platform: "x",
      transitioning: false,
      readMonitorInventory: expect.any(Function),
    });
    expect(typeof passed.executeDock).toBe("function");
    expect(passed.viewContext).toMatchObject({ docked: false, view: { surfaceOpacity: 100 } });
    expect(typeof passed.viewContext.applyView).toBe("function");
    expect(passed.transport).toMatchObject({ source: "live" });
    expect(passed.transportContext).toEqual({
      docked: false,
      deviceTransitioning: false,
      historyAvailable: true,
      historyMaxOffsetSec: 90,
    });
    expect(typeof passed.executeTransport).toBe("function");
    expect(typeof passed.uiNavigation.inspectUi).toBe("function");
    expect(passed.developmentFixtures).toEqual({ enabled: false });
    expect(passed.developmentPerformance).toMatchObject({ enabled: false });
    expect(passed.device).toMatchObject({ runtimeUnavailable: false, snapshot: null });
    expect(passed.analysisContext).toMatchObject({
      channelCount: 2,
      channelLabels: ["L", "R"],
      timeMaxWindowSec: 90,
      timeMaxOffsetSec: 85,
    });
    expect(passed.dockContext).toMatchObject({
      channelCount: 2,
      sourceMode: "live",
      activeEditors: [],
    });
    expect(passed.measurementContext.liveState).toBe("stopped");
    expect(typeof passed.measurementContext.getChannelLabels).toBe("function");
    expect(passed.workspace).toEqual({
      panelsById: {},
      panelOrder: [],
      axisViewports: { frequency: { min: 20, max: 20000 } },
    });
    expect(typeof passed.replaceWorkspace).toBe("function");
    expect(passed.settings).toEqual({ fromContext: 2 });
    expect(passed.settingsContext).toMatchObject({
      channelCount: 2,
      channelLabelMode: "auto",
      sourceMode: "live",
      dialogueDetectionActive: false,
    });
    expect(typeof passed.applySettings).toBe("function");
    expect(passed.presets).toMatchObject({ activeId: null });
    expect(passed.hasLoudnessReference).toBe(false);
    expect(passed.theme.state).toEqual({ appearance: {}, themes: [] });
  });

  it("keeps Live running when restoring File history fails source verification", async () => {
    transport.lifecycle = "running";
    transport.stop.mockClear();
    transport.switchSource.mockClear();
    transport.restore.mockRejectedValueOnce(new Error("Could not open the original file"));
    render(<AgentControlBridge />);
    const { executeTransport } = useAgentControlBridge.mock.calls.at(-1)[0];

    await expect(executeTransport("transport.file.restore", { sessionId: "old" })).rejects.toThrow(
      "Could not open the original file"
    );
    expect(transport.stop).not.toHaveBeenCalled();
    expect(transport.switchSource).not.toHaveBeenCalled();
    expect(transport.restore).toHaveBeenLastCalledWith("old", { beforeRun: expect.any(Function) });
  });

  it("switches to File for restore after preflight succeeds", async () => {
    transport.lifecycle = "running";
    const order = [];
    transport.stop.mockImplementationOnce(async () => {
      order.push("stop");
    });
    transport.switchSource.mockImplementationOnce(() => {
      order.push("switch");
    });
    transport.restore.mockImplementationOnce(async (sessionId, { beforeRun }) => {
      order.push("preflight");
      await beforeRun();
      order.push("restore");
      return { sessionId, accepted: Promise.resolve(2) };
    });
    render(<AgentControlBridge />);
    const { executeTransport } = useAgentControlBridge.mock.calls.at(-1)[0];

    await expect(executeTransport("transport.file.restore", { sessionId: "old" })).resolves.toEqual(
      {
        sessionId: "old",
        runId: 2,
      }
    );
    expect(order).toEqual(["preflight", "stop", "switch", "restore"]);
  });

  it("leaves the workbench alone when its revision changes while native probing is pending", async () => {
    transport.lifecycle = "stopped";
    transport.switchSource.mockClear();
    transport.begin.mockClear();
    let finishProbe = (_value) => {};
    transport.probe.mockReturnValueOnce(
      new Promise((resolve) => {
        finishProbe = resolve;
      })
    );
    render(<AgentControlBridge />);
    const snap = useAgentControlBridge.mock.calls.at(-1)[0];
    const state = { ...snap, transportContext: { ...snap.transportContext } };
    const clock = createRevisionClock({ onWake: () => {} });
    const revisionBatch = clock.beginBatch();
    try {
      const result = transportHandlers["transport.file.analyze"].run({
        request: {
          method: "transport.file.analyze",
          params: { path: "new.wav", expectedRevision: 0 },
        },
        requestId: "probe",
        clock,
        snap,
        live: () => state,
        settlement: createSettlementRegistry(clock),
        waiters: createWaiters(),
        visual: { captures: new Map(), recordings: new Map(), captureActive: { current: false } },
        dockRequestContext: {},
        flush: async () => {},
      });
      state.transportContext.docked = true;
      clock.bumpWorkspace();
      finishProbe({ path: "new.wav", selectedTrack: { index: 0 }, audioTracks: [{ index: 0 }] });
      await expect(result).rejects.toMatchObject({ reason: "revisionConflict" });
      expect(transport.switchSource).not.toHaveBeenCalled();
      expect(transport.begin).not.toHaveBeenCalled();
    } finally {
      clock.endBatch(revisionBatch);
    }
  });
});
