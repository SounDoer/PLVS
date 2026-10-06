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
    themeControl: { readState: () => ({ appearance: {}, themes: [] }) },
  }),
}));
vi.mock("../runtime/MeterRuntimeContext.jsx", () => ({
  useMeterRuntime: () => ({
    sourceMode: "live",
    liveLifecycle: "stopped",
    liveDeviceTransition: null,
    fileSessions: [],
    activeFileId: null,
    analyzingFileId: null,
  }),
  useMeterDisplayState: () => ({ selectedOffset: -1 }),
}));
vi.mock("../runtime/SourceContext.jsx", () => ({
  useSource: () => ({ captureDeviceId: "default" }),
}));
vi.mock("../runtime/SourceActionsContext.jsx", () => ({
  useSourceActions: () => ({
    currentFileAnalysisSettings: () => ({ dialogue: { enabled: false, engine: null } }),
  }),
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
    expect(passed.presets).toMatchObject({ activeId: null });
    expect(passed.hasLoudnessReference).toBe(false);
    expect(passed.theme.state).toEqual({ appearance: {}, themes: [] });
  });
});
