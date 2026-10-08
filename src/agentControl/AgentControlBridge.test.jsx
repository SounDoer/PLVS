/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const useAgentControlBridge = vi.hoisted(() => vi.fn());
vi.mock("./useAgentControlBridge.js", () => ({ useAgentControlBridge }));
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
    clearReady: true,
    clearCapturing: false,
    registrationError: null,
    onClearRef: { current: null },
    themeControl: { readState: () => ({ appearance: {}, themes: [] }) },
  }),
}));
vi.mock("../runtime/MeterRuntimeContext.jsx", () => ({
  useMeterRuntime: () => ({
    sourceMode: "live",
    liveLifecycle: "stopped",
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
    state: { panelsById: {}, panelOrder: [] },
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
  useAppLifecycle: () => ({ updateBusy: false }),
}));
vi.mock("../uiNavigation/UiNavigationContext.jsx", () => ({
  useUiNavigation: () => ({ inspectUi: () => ({}) }),
}));

import { AgentControlBridge } from "./AgentControlBridge.jsx";

describe("AgentControlBridge", () => {
  it("renders nothing and builds every area from its owner", async () => {
    const { container } = render(<AgentControlBridge />);

    expect(container.innerHTML).toBe("");
    const passed = useAgentControlBridge.mock.calls.at(-1)[0];
    expect(passed.enabled).toBe(true);
    expect(passed.runtime).toEqual({ available: true, platform: "x" });
    expect(passed.visual.platformCapabilities).toEqual({ platform: "x" });
    expect(passed.visual.getRuntime()).toEqual({ windowForm: "normal" });
    await expect(passed.visual.settle({ kind: "panel" }, {})).resolves.toBe("surface");
    expect(passed.dock).toMatchObject({ enabled: false, edge: "bottom", height: 72 });
    expect(passed.dockContext).toMatchObject({
      platform: "x",
      transitioning: false,
      monitors: [],
      monitorInventoryReady: false,
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
    expect(passed.workspace).toEqual({ panelsById: {}, panelOrder: [] });
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
});
