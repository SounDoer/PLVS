/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../runtime/MeterRuntimeEngines.jsx", () => ({ MeterRuntimeEngines: () => null }));
vi.mock("./AppHeader.jsx", () => ({ AppHeader: () => null }));
vi.mock("./FileAnalysisSummary.jsx", () => ({ FileAnalysisSummary: () => null }));
vi.mock("./FileDropOverlay.jsx", () => ({ FileDropOverlay: () => null }));
vi.mock("../workspace/SplitLayout.jsx", () => ({ SplitLayout: () => null }));
vi.mock("../workspace/DragContext.jsx", () => ({
  DragProvider: ({ children }) => <>{children}</>,
}));
vi.mock("../workspace/WorkspaceContext.jsx", () => ({
  useWorkspaceStore: () => ({ moveTab: vi.fn(), addPanelAt: vi.fn() }),
}));
vi.mock("../workspace/PanelDataProviders.jsx", () => ({
  PanelDataProviders: ({ children }) => <>{children}</>,
}));
vi.mock("../dock/DockStrip.jsx", () => ({ DockStrip: () => null }));
vi.mock("./RecordingIndicator.jsx", () => ({ RecordingIndicator: () => null }));

import { AppShell } from "./AppShell.jsx";

const baseFooter = {
  sourceLabel: "Output · Test Device",
  audioDrop: null,
  loudnessProfileName: null,
  activePresetName: "Default",
  hasUpdate: false,
};

const baseProps = {
  frameData: {},
  historyData: {},
  metricsData: {},
  runtimeEnginesProps: {},
  fileDropProps: {},
  focusView: { autoHideControls: false },
  focusControlsVisible: true,
  shellHandlers: {},
  headerProps: {},
  showFileAnalysisResult: false,
  fileSummaryProps: {},
  panelChromeData: {},
};

describe("AppShell footer", () => {
  it("prompts for a layout only when one is unknown and channels are present", () => {
    const onOpenSettings = vi.fn();
    const { rerender } = render(
      <AppShell {...baseProps} footer={{ ...baseFooter, layoutUnknown: true, onOpenSettings }} />
    );

    const prompt = screen.getByRole("button", { name: /channel layout unknown/i });
    fireEvent.click(prompt);
    expect(onOpenSettings).toHaveBeenCalled();

    rerender(
      <AppShell {...baseProps} footer={{ ...baseFooter, layoutUnknown: false, onOpenSettings }} />
    );
    expect(screen.queryByRole("button", { name: /channel layout unknown/i })).toBeNull();
  });
});
