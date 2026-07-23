/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FrameDataProvider, HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DEFAULT_DOCK_CONTROLS_BY_MODULE_ID } from "../dockModuleControls.js";
import { DockLoudness } from "./DockLoudness.jsx";

function renderWith({
  displayAudio,
  histSourceList = [],
  controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness,
  heightMode = "standard",
  // Null is the Off default: the reference comes from the active Loudness Profile.
  referenceLufs = null,
}) {
  return render(
    <FrameDataProvider value={{ displayAudio }}>
      <HistoryDataProvider value={{ histSourceList, referenceLufs }}>
        <DockLoudness controls={controls} heightMode={heightMode} />
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

describe("DockLoudness", () => {
  it("shows M, ST, and I readouts to the right of history", () => {
    renderWith({ displayAudio: { momentary: -18.2, shortTerm: -19.4, integrated: -20.1 } });

    const readoutRows = screen.getAllByTestId("dock-loudness-readout");
    expect(readoutRows.map((node) => node.textContent)).toEqual(["M-18.2", "ST-19.4", "I-20.1"]);
    const readouts = screen.getByTestId("dock-loudness-readouts");
    expect(readouts.className).toContain("items-baseline");
    expect(readouts.style.gridTemplateColumns).toBe("max-content max-content");
    expect(readouts.style.columnGap).toBe("var(--ui-dock-gap-column)");
    expect(
      screen
        .getAllByTestId("dock-loudness-readout-label")
        .every((node) => node.className.includes("justify-self-start"))
    ).toBe(true);
    expect(
      ["-18.2", "-19.4", "-20.1"].every((value) =>
        screen.getByText(value).className.includes("w-[var(--ui-dock-readout-w)]")
      )
    ).toBe(true);
    const history = screen.getByTestId("dock-loudness-history");
    expect(
      history.compareDocumentPosition(readouts) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("lets the history fill the panel when readouts are hidden", () => {
    renderWith({
      displayAudio: { momentary: -18.2, shortTerm: -19.4, integrated: -20.1 },
      controls: {
        ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness,
        showReadouts: false,
      },
    });

    expect(screen.queryByTestId("dock-loudness-readouts")).toBeNull();
    expect(screen.getByTestId("dock-loudness-history").parentElement.className).toContain("flex-1");
  });

  it("moves two-line readouts below the history in Expanded mode", () => {
    renderWith({
      displayAudio: { momentary: -18.2, shortTerm: -19.4, integrated: -20.1 },
      heightMode: "expanded",
    });

    const history = screen.getByTestId("dock-loudness-history");
    const readouts = screen.getByTestId("dock-loudness-readouts");
    expect(readouts.className).toContain("grid-cols-3");
    expect(
      history.compareDocumentPosition(readouts) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getAllByTestId("dock-expanded-metric-unit").map((node) => node.textContent)
    ).toEqual(["LUFS", "LUFS", "LUFS"]);
    expect(screen.getAllByTestId("dock-loudness-readout").map((node) => node.textContent)).toEqual([
      "M-18.2LUFS",
      "ST-19.4LUFS",
      "I-20.1LUFS",
    ]);
    expect(
      screen
        .getAllByTestId("dock-expanded-metric")
        .every((node) => node.className.includes("items-start"))
    ).toBe(true);
    expect(
      screen
        .getAllByTestId("dock-loudness-readout")
        .every((node) => node.className.includes("min-w-0"))
    ).toBe(true);
  });

  it("uses the normal panel's Momentary, Short-term, and Reference layer semantics", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ m: -30 + i * 0.1, st: -28 + i * 0.2 }));
    renderWith({
      displayAudio: { momentary: -18.2, shortTerm: -19.4, integrated: -20.1 },
      histSourceList: rows,
      referenceLufs: -23,
    });

    const momentary = screen.getByTestId("dock-loudness-momentary");
    const shortTerm = screen.getByTestId("dock-loudness-short-term");
    expect(momentary.getAttribute("stroke")).toBe("var(--ui-loudness-momentary)");
    expect(shortTerm.getAttribute("stroke")).toBe("var(--ui-loudness-shortterm)");
    // The reference now shows as a guide line rather than tinting the traces.
    expect(screen.getByTestId("dock-loudness-reference-line")).toBeTruthy();
  });

  it("keeps the history paths advancing after the live ring fills", () => {
    const histSourceList = [
      { m: -20, st: -21, timestampMs: 1000 },
      { m: -20, st: -21, timestampMs: 1100 },
      { m: -20, st: -21, timestampMs: 1200 },
      { m: -20, st: -21, timestampMs: 1300 },
    ];
    const displayAudio = { momentary: -20, shortTerm: -21, integrated: -22 };
    const view = renderWith({ displayAudio, histSourceList });
    const firstMomentaryPath = screen.getByTestId("dock-loudness-momentary").getAttribute("d");
    const firstShortTermPath = screen.getByTestId("dock-loudness-short-term").getAttribute("d");

    histSourceList.shift();
    histSourceList.push({ m: -6, st: -8, timestampMs: 1400 });
    view.rerender(
      <FrameDataProvider value={{ displayAudio }}>
        <HistoryDataProvider value={{ histSourceList }}>
          <DockLoudness controls={DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness} />
        </HistoryDataProvider>
      </FrameDataProvider>
    );

    expect(screen.getByTestId("dock-loudness-momentary").getAttribute("d")).not.toBe(
      firstMomentaryPath
    );
    expect(screen.getByTestId("dock-loudness-short-term").getAttribute("d")).not.toBe(
      firstShortTermPath
    );
  });

  it("hides unselected history layers and disables the reference gradient", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ m: -30 + i * 0.1, st: -28 + i * 0.2 }));
    renderWith({
      displayAudio: { momentary: -18.2, shortTerm: -19.4, integrated: -20.1 },
      histSourceList: rows,
      referenceLufs: -23,
      controls: {
        ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness,
        loudnessHistoryVisibleLayerIds: ["momentary"],
      },
    });

    expect(screen.getByTestId("dock-loudness-momentary").getAttribute("stroke")).toBe(
      "var(--ui-loudness-momentary)"
    );
    expect(screen.queryByTestId("dock-loudness-short-term")).toBeNull();
  });

  it("drops the reference gradient when no profile is active, whatever the layer ids say", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ m: -30 + i * 0.1, st: -28 + i * 0.2 }));
    renderWith({
      displayAudio: { momentary: -18.2, shortTerm: -19.4, integrated: -20.1 },
      histSourceList: rows,
      referenceLufs: null,
    });

    // `ref` is still in the default layer ids; the null reference is what silences it.
    expect(DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness.loudnessHistoryVisibleLayerIds).toContain(
      "ref"
    );
    expect(screen.getByTestId("dock-loudness-momentary").getAttribute("stroke")).toBe(
      "var(--ui-loudness-momentary)"
    );
  });

  it("uses the configured Y range and renders dashes for non-finite readouts", () => {
    const rows = [
      { m: -48, st: -40 },
      { m: -24, st: -20 },
    ];
    const controls = {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness,
      loudnessYMinDb: -48,
      loudnessYMaxDb: -12,
    };
    renderWith({
      displayAudio: { momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity },
      histSourceList: rows,
      controls,
    });

    expect(screen.getAllByText("-")).toHaveLength(3);
    expect(screen.getByTestId("dock-loudness-momentary").getAttribute("d")).toContain("60");
  });
});
