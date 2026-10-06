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

import { AgentControlBridge } from "./AgentControlBridge.jsx";
import { standIn } from "../testing/standIn.js";

describe("AgentControlBridge", () => {
  it("renders nothing and builds the Dock and View areas from their owners", () => {
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
  });
});
