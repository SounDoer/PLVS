/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { standIn } from "../testing/standIn.js";
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

// Every child these bundles are forwarded to is mocked above, so empty ones stand in for them.
/** @type {import("react").ComponentProps<typeof AppShell>} */
const baseProps = standIn({
  frameData: {},
  historyData: {},
  metricsData: {},
  runtimeEnginesProps: {},
  fileDropProps: {},
  focusView: { autoHideControls: false, compactPanels: false, borderless: false },
  focusControlsVisible: true,
  shellHandlers: {},
  headerProps: {},
  showFileAnalysisResult: false,
  fileSummaryProps: {},
  panelChromeData: {},
});

describe("AppShell footer", () => {
  it("keeps updates out of the permanent footer", () => {
    render(
      <AppShell
        {...baseProps}
        headerProps={standIn({
          statusItems: [
            { id: "update", kind: "update", text: "Update Available", details: "Update Available" },
          ],
        })}
        footer={baseFooter}
      />
    );
    expect(screen.queryByText(/Update Available/)).toBeNull();
    expect(screen.getByText("Source")).toBeTruthy();
  });

  it("marks only the main workspace as History while a snapshot is selected", () => {
    const { rerender } = render(
      <AppShell {...baseProps} historyData={{ selectedOffset: 2 }} footer={baseFooter} />
    );
    expect(
      document.querySelector('[data-visual-capture-surface="main"]')?.hasAttribute("data-history")
    ).toBe(true);

    rerender(<AppShell {...baseProps} historyData={{ selectedOffset: -1 }} footer={baseFooter} />);
    expect(
      document.querySelector('[data-visual-capture-surface="main"]')?.hasAttribute("data-history")
    ).toBe(false);

    rerender(
      <AppShell
        {...baseProps}
        historyData={{ selectedOffset: 2, sourceMode: "file" }}
        footer={baseFooter}
      />
    );
    expect(
      document.querySelector('[data-visual-capture-surface="main"]')?.hasAttribute("data-history")
    ).toBe(false);
  });
  it("keeps layout warnings and audio-drop conditions out of the footer", () => {
    render(
      <AppShell
        {...baseProps}
        headerProps={standIn({
          statusItems: [
            {
              id: "channel-layout",
              kind: "warning",
              text: "Channel Layout Unknown",
              details: "Loudness uses channels 1–2.",
            },
          ],
        })}
        footer={baseFooter}
      />
    );
    expect(screen.queryByText(/Channel Layout Unknown/i)).toBeNull();
    expect(screen.queryByText(/Audio Dropped/i)).toBeNull();
  });

  it("shows the preset item only while a preset is active", () => {
    const { rerender } = render(<AppShell {...baseProps} footer={baseFooter} />);
    expect(screen.getByText("Preset")).toBeTruthy();
    expect(screen.getByText("Default")).toBeTruthy();

    rerender(<AppShell {...baseProps} footer={{ ...baseFooter, activePresetName: null }} />);
    expect(screen.queryByText("Preset")).toBeNull();
  });
});
