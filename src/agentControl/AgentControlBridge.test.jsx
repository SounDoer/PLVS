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
    running: false,
    liveDeviceTransition: null,
    fileSessions: [],
    activeFileId: null,
    analyzingFileId: null,
  }),
  useMeterDisplayState: () => ({ selectedOffset: -1 }),
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
    setChannelRolesForControl: async () => {},
    setDialogueVadEngineForControl: async () => {},
  }),
}));
vi.mock("./settingsControl.js", () => ({
  buildPublicSettings: (_settings, context) => ({ fromContext: context.channelCount }),
}));
vi.mock("../hooks/AppLifecycleContext.jsx", () => ({
  useAppLifecycle: () => ({ updateBusy: false }),
}));
vi.mock("../uiNavigation/UiNavigationContext.jsx", () => ({
  useUiNavigation: () => ({ inspectUi: () => ({}) }),
}));

import { AgentControlBridge } from "./AgentControlBridge.jsx";
import { standIn } from "../testing/standIn.js";

describe("AgentControlBridge", () => {
  it("renders nothing and builds each owned area from its owner", () => {
    const props = standIn({
      enabled: false,
      runtime: { available: false },
      dockContext: { platform: "x" },
    });
    const { container } = render(<AgentControlBridge {...props} />);

    expect(container.innerHTML).toBe("");
    const passed = useAgentControlBridge.mock.calls.at(-1)[0];
    expect(passed.enabled).toBe(false);
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
    expect(passed.transportContext).toEqual({ docked: false, deviceTransitioning: false });
    expect(typeof passed.executeTransport).toBe("function");
    expect(typeof passed.uiNavigation.inspectUi).toBe("function");
    expect(passed.device).toMatchObject({ runtimeUnavailable: false, snapshot: null });
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
