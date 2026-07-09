/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MetricsDataProvider, PanelInstanceProvider } from "../../workspace/AudioDataContext.jsx";
import { StatsPanel } from "./StatsPanel.jsx";

const statsMetrics = [
  {
    id: "momentary",
    label: "Momentary",
    shortLabel: "M",
    value: "-20.0",
    unit: "LUFS",
    hint: "Loudness over a 400ms window",
  },
  {
    id: "shortTerm",
    label: "Short-term",
    shortLabel: "ST",
    value: "-18.0",
    unit: "LUFS",
    hint: "Loudness over a 3s window",
  },
  {
    id: "integrated",
    label: "Integrated",
    shortLabel: "I",
    value: "-19.0",
    unit: "LUFS",
    hint: "Loudness over the whole program, gated below −70 LUFS",
  },
  {
    id: "lra",
    label: "Loudness Range",
    shortLabel: "LRA",
    value: "3.0",
    unit: "LU",
    hint: "LRA, loudness range over the whole program",
  },
  {
    id: "psr",
    label: "Short-term Dynamics",
    shortLabel: "PSR",
    value: "7.0",
    unit: "dB",
    hint: "PSR, Peak to Short-term loudness Ratio",
  },
  {
    id: "plr",
    label: "Integrated Dynamics",
    shortLabel: "PLR",
    value: "8.0",
    unit: "dB",
    hint: "PLR, Peak to Loudness Ratio",
  },
];

function renderPanel(visibleIds) {
  return renderStatsPanel({
    shared: { statsMetrics, dialogueActiveNow: true },
    panelControls: { statsVisibleIds: visibleIds },
  });
}

function renderStatsPanel({ shared, panelControls }) {
  return render(
    <MetricsDataProvider
      value={{
        ...shared,
      }}
    >
      <PanelInstanceProvider value={{ panelControls }}>
        <StatsPanel />
      </PanelInstanceProvider>
    </MetricsDataProvider>
  );
}

describe("StatsPanel", () => {
  it("renders only visible stats", () => {
    renderPanel(["integrated", "psr"]);

    expect(screen.getByText("Integrated")).toBeTruthy();
    expect(screen.getByText("Short-term Dynamics")).toBeTruthy();
    expect(screen.queryByText("Momentary")).toBeNull();
    expect(screen.queryByText("Short-term")).toBeNull();
  });

  it("exposes the hover hint for a visible metric", () => {
    renderPanel(["integrated"]);

    fireEvent.mouseEnter(screen.getByText("Integrated"));

    expect(screen.getByText("Loudness over the whole program, gated below −70 LUFS")).toBeTruthy();
  });

  it("renders an empty state when no stats are selected", () => {
    renderPanel([]);

    expect(screen.getByText("No stats selected").className).toContain(
      "px-[var(--ui-metric-row-pad-x)]"
    );
    expect(screen.queryByText("Momentary")).toBeNull();
  });

  it("renders an empty state when visible stats are null", () => {
    renderPanel(null);

    expect(screen.getByText("No stats selected")).toBeTruthy();
    expect(screen.queryByText("Momentary")).toBeNull();
  });

  it("does not render metric rows as buttons", () => {
    renderPanel(["momentary"]);

    expect(screen.queryByRole("button", { name: /Momentary/ })).toBeNull();
    expect(screen.getByText("Momentary")).toBeTruthy();
  });

  it("keeps stats rows tight with horizontal padding only", () => {
    renderPanel(["momentary"]);

    const row = screen.getByText("Momentary").parentElement?.parentElement;

    expect(row?.className).toContain("gap-[var(--ui-metric-row-gap)]");
    expect(row?.className).toContain("px-[var(--ui-metric-row-pad-x)]");
    expect(row?.className).not.toContain("py-[var(--ui-metric-row-pad-y)]");
    expect(row?.className).not.toContain("rounded-[var(--ui-radius-metric-row)]");
  });

  it("abbreviates metric labels at medium pane widths and hides units only later", () => {
    const { container } = renderPanel(["momentary"]);

    const panel = container.firstElementChild;
    const fullLabel = screen.getByText("Momentary");
    const shortLabel = screen.getByText("M");
    const value = screen.getByText("-20.0");
    const unit = screen.getByText("LUFS");

    expect(panel?.className).toContain("@container");
    expect(fullLabel.className).toContain("@max-[240px]:hidden");
    expect(shortLabel.className).toContain("hidden");
    expect(shortLabel.className).toContain("@max-[240px]:inline");
    expect(value.className).toContain("shrink-0");
    expect(value.getAttribute("style")).toContain("width: 5.5ch");
    expect(unit.className).toContain("@max-[180px]:hidden");
  });

  it("shows an active speaking-now dot when dialogueCoverage is visible and dialogueActiveNow is true", () => {
    renderStatsPanel({
      shared: {
        statsMetrics: [
          { id: "dialogueCoverage", label: "Dialogue Coverage", value: "62", unit: "%" },
        ],
        dialogueActiveNow: true,
      },
      panelControls: { statsVisibleIds: ["dialogueCoverage"] },
    });

    expect(screen.getByTestId("dialogue-active-dot").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("dialogue-active-dot").className).not.toContain("mr-1");
    expect(screen.getByTestId("dialogue-active-dot").className).toContain("h-1.5");
    expect(screen.getByTestId("dialogue-active-dot").className).toContain("w-1.5");
  });

  it("renders visible metrics in statsOrder, ignoring hidden ids", () => {
    renderStatsPanel({
      shared: { statsMetrics },
      panelControls: {
        statsVisibleIds: ["momentary", "integrated", "psr"],
        statsOrder: ["psr", "lra", "integrated", "momentary", "shortTerm"],
      },
    });

    const labels = screen
      .getAllByText(/Momentary|Integrated|Short-term Dynamics/)
      .map((el) => el.textContent);
    expect(labels).toEqual(["Short-term Dynamics", "Integrated", "Momentary"]);
  });
});
