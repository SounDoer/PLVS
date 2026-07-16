import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATS_CANONICAL_ORDER, STATS_META } from "../../lib/statsCatalog.js";
import { MetricsDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockStats } from "./DockStats.jsx";

const METRICS = [
  { id: "integrated", shortLabel: "I", unit: "LUFS", value: "-20.1" },
  { id: "truePeak", shortLabel: "TP Max", unit: "dBTP", value: "-3.2" },
  { id: "lra", shortLabel: "LRA", unit: "LU", value: "7.4" },
  { id: "psr", shortLabel: "PSR", unit: "dB", value: "11.0" },
];

let triggerResize;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback) {
        triggerResize = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function statsControls(statsVisibleIds, statsOrder = statsVisibleIds) {
  return {
    statsVisibleIds,
    statsOrder: [...statsOrder, ...STATS_CANONICAL_ORDER.filter((id) => !statsOrder.includes(id))],
  };
}

function renderWith(statsMetrics, controls, shared = {}, heightMode = "standard") {
  return render(
    <MetricsDataProvider value={{ statsMetrics, ...shared }}>
      <DockStats controls={controls} heightMode={heightMode} />
    </MetricsDataProvider>
  );
}

describe("DockStats", () => {
  it("renders the default selection in Dock priority order", () => {
    renderWith(METRICS);
    const stats = screen.getAllByTestId("dock-stat");
    expect(stats).toHaveLength(3);
    expect(stats.map((row) => row.textContent)).toEqual(["I-20.1", "TP Max-3.2", "LRA7.4"]);
    expect(screen.getByTestId("dock-stats-grid").style.gridTemplateColumns).toBe("minmax(0, 72px)");
    expect(stats[0].className).toContain("flex");
    expect(stats[0].style.gap).toBe("2px");
    expect(screen.getByText("TP Max").closest("[data-testid='dock-stat-label']")?.title).toBe(
      "TP Max"
    );
  });

  it("respects independent visibility and ordering controls", () => {
    renderWith(METRICS, statsControls(["psr", "integrated"], ["integrated", "psr"]));
    expect(screen.getAllByTestId("dock-stat").map((row) => row.textContent)).toEqual([
      "I-20.1",
      "PSR11.0",
    ]);
  });

  it("uses shared Dock typography and omits units", () => {
    renderWith(METRICS, statsControls(["integrated"]));
    expect(screen.getByText("I").parentElement?.className).toContain("var(--ui-dock-fs-label)");
    expect(screen.getByText("-20.1").className).toContain("var(--ui-dock-fs-value)");
    expect(screen.queryByText("LUFS")).toBeNull();
  });

  it("uses two-line metrics with units in Expanded mode", () => {
    renderWith(METRICS, statsControls(["integrated", "truePeak", "correlation"]), {}, "expanded");

    expect(screen.getByTestId("dock-stats-grid").style.gridTemplateColumns).toBe("minmax(0, 84px)");
    expect(screen.getAllByTestId("dock-expanded-metric")).toHaveLength(3);
    expect(
      screen.getAllByTestId("dock-expanded-metric-unit").map((node) => node.textContent)
    ).toEqual(["LUFS", "dBTP"]);
    expect(screen.getAllByTestId("dock-stat").map((node) => node.textContent)).toEqual([
      "I-20.1LUFS",
      "TP Max-3.2dBTP",
      "Corr-",
    ]);
  });

  it("keeps a long label shrinkable without letting it overlap the fixed value", () => {
    renderWith(
      [{ id: "dialogueOffset", shortLabel: "Dlg Offset", value: "+0.9" }],
      statsControls(["dialogueOffset"])
    );

    const stat = screen.getByTestId("dock-stat");
    const label = screen.getByTestId("dock-stat-label");
    const labelText = screen.getByText("Dlg Offset");
    const value = screen.getByText("+0.9");
    expect(stat.className).toContain("flex");
    expect(label.className).toContain("flex-1");
    expect(labelText.className).toContain("min-w-0");
    expect(value.className).toContain("shrink-0");
  });

  it("renders a dash when a selected metric is missing from the feed", () => {
    renderWith(METRICS, statsControls(["sideToMid"]));
    expect(screen.getByText("-")).toBeTruthy();
  });

  it("shows dialogue activity on the Dialogue Coverage metric", () => {
    renderWith(
      [{ id: "dialogueCoverage", shortLabel: "Dlg Cov", value: "62" }],
      statsControls(["dialogueCoverage"]),
      { dialogueActiveNow: true }
    );
    expect(screen.getByTestId("dock-dialogue-active-dot").getAttribute("data-active")).toBe("true");
  });

  it("shows only three rows worth of metrics and reveals more as width grows", () => {
    const ids = STATS_CANONICAL_ORDER.slice(0, 10);
    const metrics = ids.map((id, index) => ({
      id,
      shortLabel: STATS_META[id].shortLabel,
      value: String(index),
    }));
    renderWith(metrics, statsControls(ids));

    act(() => triggerResize([{ contentRect: { width: 132 } }]));
    expect(screen.getByTestId("dock-stats-grid").getAttribute("data-column-count")).toBe("2");
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(6);
    expect(screen.queryByText("6")).toBeNull();

    act(() => triggerResize([{ contentRect: { width: 204 } }]));
    expect(screen.getByTestId("dock-stats-grid").getAttribute("data-column-count")).toBe("3");
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(9);
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.queryByText("9")).toBeNull();
    const lastVisibleStat = screen.getByText("8").closest("[data-testid='dock-stat']");
    expect(lastVisibleStat?.style.gridRow).toBe("3");
    expect(lastVisibleStat?.style.gridColumn).toBe("5");
  });

  it("keeps an incomplete final row aligned on the shared grid", () => {
    const ids = STATS_CANONICAL_ORDER;
    const metrics = ids.map((id, index) => ({
      id,
      shortLabel: STATS_META[id].shortLabel,
      value: `v${index}`,
    }));
    renderWith(metrics, statsControls(ids));

    act(() => triggerResize([{ contentRect: { width: 420 } }]));

    expect(screen.getByTestId("dock-stats-grid").getAttribute("data-column-count")).toBe("6");
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(15);
    expect(screen.getByText("v11").closest("[data-testid='dock-stat']")?.style).toMatchObject({
      gridRow: "2",
      gridColumn: "11",
    });
    expect(screen.getByText("v12").closest("[data-testid='dock-stat']")?.style).toMatchObject({
      gridRow: "3",
      gridColumn: "1",
    });
    expect(screen.getByText("v14").closest("[data-testid='dock-stat']")?.style).toMatchObject({
      gridRow: "3",
      gridColumn: "5",
    });
  });

  it("uses five Expanded columns at the Stats maximum content width", () => {
    const ids = STATS_CANONICAL_ORDER;
    const metrics = ids.map((id, index) => ({
      id,
      shortLabel: STATS_META[id].shortLabel,
      value: `v${index}`,
    }));
    renderWith(metrics, statsControls(ids), {}, "expanded");

    act(() => triggerResize([{ contentRect: { width: 404 } }]));

    expect(screen.getByTestId("dock-stats-grid").getAttribute("data-column-count")).toBe("5");
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(15);
    expect(screen.getAllByTestId("dock-expanded-metric-unit")[0].className).toContain(
      "@max-[68px]:hidden"
    );
  });

  it("renders the empty state when no metrics are selected", () => {
    renderWith(METRICS, statsControls([]));
    expect(screen.getByText("No stats selected")).toBeTruthy();
  });
});
