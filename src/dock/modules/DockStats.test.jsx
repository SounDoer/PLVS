/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATS_CANONICAL_ORDER, STATS_META } from "../../lib/statsCatalog.js";
import {
  FrameDataProvider,
  MetricsDataProvider,
  PanelInstanceProvider,
} from "../../workspace/AudioDataContext.jsx";
import { DockStats } from "./DockStats.jsx";
import { StatsPanel } from "../../components/panels/StatsPanel.jsx";
import { settingsStore } from "../../persistence/index.js";
import { profileSelectionId } from "../../lib/loudnessProfileCatalog.js";
import {
  LoudnessProfileProvider,
  useLoudnessProfile,
} from "../../hooks/LoudnessProfileContext.jsx";

const TEST_PROFILE = {
  id: "test-profile",
  name: "Test profile",
  referenceLufs: -23,
  rules: [
    { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
    { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
    { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
  ],
};

function selectTestProfile() {
  settingsStore.patch({
    loudnessProfiles: {
      active: profileSelectionId(TEST_PROFILE.id),
      profiles: [TEST_PROFILE],
    },
  });
}

const METRICS = [
  { id: "momentary", shortLabel: "M", unit: "LUFS", value: "-18.1" },
  { id: "shortTerm", shortLabel: "ST", unit: "LUFS", value: "-19.2" },
  { id: "integrated", shortLabel: "I", unit: "LUFS", value: "-20.1" },
  { id: "momentaryMax", shortLabel: "M Max", unit: "LUFS", value: "-15.0" },
  { id: "shortTermMax", shortLabel: "ST Max", unit: "LUFS", value: "-16.0" },
  { id: "lra", shortLabel: "LRA", unit: "LU", value: "7.4" },
  { id: "psr", shortLabel: "PSR", unit: "dB", value: "11.0" },
  { id: "plr", shortLabel: "PLR", unit: "dB", value: "16.9" },
  { id: "truePeak", shortLabel: "TP Max", unit: "dBTP", value: "-3.2" },
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

function renderWith(statsMetrics, controls, shared = {}, displayAudio) {
  return render(
    <LoudnessProfileProvider>
      <FrameDataProvider value={{ displayAudio }}>
        <MetricsDataProvider value={{ statsMetrics, ...shared }}>
          <DockStats controls={controls} />
        </MetricsDataProvider>
      </FrameDataProvider>
    </LoudnessProfileProvider>
  );
}

describe("DockStats", () => {
  it("renders the normal Stats defaults in canonical order", () => {
    renderWith(METRICS);
    const stats = screen.getAllByTestId("dock-stat");
    expect(stats).toHaveLength(8);
    expect(stats.slice(0, 3).map((row) => row.textContent)).toEqual([
      "M-18.1",
      "ST-19.2",
      "I-20.1",
    ]);
    expect(screen.getByTestId("dock-stats-grid").style.gridTemplateColumns).toBe("minmax(0, 72px)");

    expect(stats[0].style.gap).toBe("2px");
    expect(
      /** @type {HTMLElement} */ (screen.getByText("M").closest("[data-testid='dock-stat-label']"))
        ?.title
    ).toBe("");
  });

  it("shows the catalog hint in a themed tooltip without changing the cell layout", () => {
    renderWith(METRICS, statsControls(["momentary"]));

    const stat = screen.getByTestId("dock-stat");
    expect(stat.title).toBe("");
    fireEvent.mouseEnter(stat);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toBe(STATS_META.momentary.hint);
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

    expect(screen.queryByText("LUFS")).toBeNull();
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

  it("retains all metrics as the available width changes", () => {
    const ids = STATS_CANONICAL_ORDER.slice(0, 10);
    const metrics = ids.map((id, index) => ({
      id,
      shortLabel: STATS_META[id].shortLabel,
      value: String(index),
    }));
    renderWith(metrics, statsControls(ids));

    act(() =>
      triggerResize([
        { target: screen.getByTestId("dock-stats-grid"), contentRect: { width: 132 } },
      ])
    );
    expect(screen.getByTestId("dock-stats-grid").getAttribute("data-column-count")).toBe("2");
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(10);
    expect(screen.queryByText("6")).toBeTruthy();

    act(() =>
      triggerResize([
        { target: screen.getByTestId("dock-stats-grid"), contentRect: { width: 204 } },
      ])
    );
    expect(screen.getByTestId("dock-stats-grid").getAttribute("data-column-count")).toBe("3");
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(10);
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.queryByText("9")).toBeTruthy();
    const lastVisibleStat = screen.getByText("8").closest("[data-testid='dock-stat']");
    expect(/** @type {HTMLElement} */ (lastVisibleStat)?.style.gridRow).toBe("3");
    expect(/** @type {HTMLElement} */ (lastVisibleStat)?.style.gridColumn).toBe("5");
  });

  it("keeps an incomplete final row aligned on the shared grid", () => {
    const ids = STATS_CANONICAL_ORDER;
    const metrics = ids.map((id, index) => ({
      id,
      shortLabel: STATS_META[id].shortLabel,
      value: `v${index}`,
    }));
    renderWith(metrics, statsControls(ids));

    act(() =>
      triggerResize([
        { target: screen.getByTestId("dock-stats-grid"), contentRect: { width: 420 } },
      ])
    );

    expect(screen.getByTestId("dock-stats-grid").getAttribute("data-column-count")).toBe("6");
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(15);
    expect(
      /** @type {HTMLElement} */ (screen.getByText("v11").closest("[data-testid='dock-stat']"))
        ?.style
    ).toMatchObject({
      gridRow: "2",
      gridColumn: "11",
    });
    expect(
      /** @type {HTMLElement} */ (screen.getByText("v12").closest("[data-testid='dock-stat']"))
        ?.style
    ).toMatchObject({
      gridRow: "3",
      gridColumn: "1",
    });
    expect(
      /** @type {HTMLElement} */ (screen.getByText("v14").closest("[data-testid='dock-stat']"))
        ?.style
    ).toMatchObject({
      gridRow: "3",
      gridColumn: "5",
    });
  });

  it("uses five columns at the Stats maximum content width", () => {
    const ids = STATS_CANONICAL_ORDER;
    const metrics = ids.map((id, index) => ({
      id,
      shortLabel: STATS_META[id].shortLabel,
      value: `v${index}`,
    }));
    renderWith(metrics, statsControls(ids));

    act(() =>
      triggerResize([
        { target: screen.getByTestId("dock-stats-grid"), contentRect: { width: 404 } },
      ])
    );

    expect(screen.getByTestId("dock-stats-grid").getAttribute("data-column-count")).toBe("5");
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(15);
  });

  it("refits columns when a cell grows after a text-size change without a window resize", () => {
    const ids = STATS_CANONICAL_ORDER;
    renderWith(
      ids.map((id) => ({ id, shortLabel: STATS_META[id].shortLabel, value: "-18.1" })),
      statsControls(ids)
    );
    const grid = screen.getByTestId("dock-stats-grid");
    Object.defineProperty(grid, "clientWidth", { value: 420 });
    Object.defineProperty(grid, "clientHeight", { value: 40 });
    grid.style.fontSize = "13px";
    act(() => triggerResize([{ target: grid, contentRect: { width: 420, height: 40 } }]));
    const before = Number(grid.getAttribute("data-column-count"));
    grid.style.fontSize = "24px";
    act(() =>
      triggerResize([
        { target: screen.getAllByTestId("dock-stat")[0], contentRect: { width: 100, height: 24 } },
      ])
    );
    expect(Number(grid.getAttribute("data-column-count"))).toBeLessThan(before);
    expect(screen.getAllByTestId("dock-stat")).toHaveLength(ids.length);
  });

  it("renders the empty state when no metrics are selected", () => {
    renderWith(METRICS, statsControls([]));
    expect(screen.getByText("No stats selected")).toBeTruthy();
  });
});

describe("DockStats profile status colours", () => {
  afterEach(() => settingsStore.reset());

  const visible = statsControls(["integrated"]);

  // METRICS supplies the display string; displayAudio supplies the number status is judged on.
  function valueStatus() {
    return screen.getByText("-20.1").dataset.loudnessStatus;
  }

  it("leaves values uncoloured while the profile is Off", () => {
    settingsStore.patch({ loudnessProfiles: { active: "off", profiles: [TEST_PROFILE] } });
    renderWith(METRICS, visible, {}, { integrated: -23 });
    expect(valueStatus()).toBe("off");
  });

  it("colours a breach the same way the normal Stats panel does", () => {
    // The dock is a second implementation; the same metric under the same profile must not
    // read as a breach in one panel and neutral in the other.
    selectTestProfile();
    renderWith(METRICS, visible, {}, { integrated: -18 });
    expect(valueStatus()).toBe("fail");
  });

  it("keeps an in-range watched value at foreground", () => {
    selectTestProfile();
    renderWith(METRICS, visible, {}, { integrated: -23 });
    expect(valueStatus()).toBe("ok");
  });
});

describe("Dock Stats and the main window under one provider", () => {
  afterEach(() => settingsStore.reset());

  // Both surfaces rendered in one tree, sharing one LoudnessProfileProvider: the same metric under
  // the same profile must not read as a breach in one surface and neutral in the other.
  /**
   * @param {any} displayAudio
   * @param {{ onProfile?: (...args: any[]) => any }} [options]
   */
  function renderBothSurfaces(displayAudio, { onProfile } = {}) {
    function ProfileHandle() {
      const profile = useLoudnessProfile();
      onProfile?.(profile);
      return null;
    }

    return render(
      <LoudnessProfileProvider>
        <FrameDataProvider value={{ displayAudio }}>
          <MetricsDataProvider value={{ statsMetrics: METRICS }}>
            <ProfileHandle />
            <PanelInstanceProvider
              value={{ panelControls: { statsVisibleIds: ["truePeak"], statsOrder: ["truePeak"] } }}
            >
              <StatsPanel />
            </PanelInstanceProvider>
            <DockStats controls={statsControls(["truePeak"])} />
          </MetricsDataProvider>
        </FrameDataProvider>
      </LoudnessProfileProvider>
    );
  }

  function truePeakStatuses(container) {
    return [...container.querySelectorAll("[data-stat-value='truePeak']")].map(
      (node) => node.dataset.loudnessStatus
    );
  }

  it("colours a breached metric identically in both surfaces", () => {
    selectTestProfile();
    const { container } = renderBothSurfaces({ tpMax: 0 });

    expect(truePeakStatuses(container)).toEqual(["fail", "fail"]);
  });

  it("leaves the metric neutral in both surfaces while the profile is Off", () => {
    settingsStore.patch({ loudnessProfiles: { active: "off", profiles: [TEST_PROFILE] } });
    const { container } = renderBothSurfaces({ tpMax: 0 });

    expect(truePeakStatuses(container)).toEqual(["off", "off"]);
  });

  // A persisted selection cannot diverge between two providers -- both would read the same store.
  // A preview draft never reaches the store, so this is the case that actually fails if the two
  // surfaces ever stop sharing one provider.
  it("follows an unsaved draft in both surfaces", () => {
    selectTestProfile();
    let profile;
    const { container } = renderBothSurfaces(
      { tpMax: -5 },
      /** @type {Parameters<typeof renderBothSurfaces>[1]} */ ({
        onProfile: (p) => (profile = p),
      })
    );

    // -5 dBTP clears the test profile's -1 limit, so both surfaces start neutral.
    expect(truePeakStatuses(container)).toEqual(["ok", "ok"]);

    act(() => profile.beginCreate());
    act(() =>
      profile.editDraft((d) => ({
        ...d,
        rules: [{ metricId: "truePeak", op: ">", value: -12, severity: "fail" }],
      }))
    );

    expect(truePeakStatuses(container)).toEqual(["fail", "fail"]);
  });
});
