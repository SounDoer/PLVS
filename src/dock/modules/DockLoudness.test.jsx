import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FrameDataProvider, HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DEFAULT_DOCK_CONTROLS_BY_MODULE_ID } from "../dockModuleControls.js";
import { DockLoudness } from "./DockLoudness.jsx";

function renderWith({
  displayAudio,
  histSourceList = [],
  controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.loudness,
}) {
  return render(
    <FrameDataProvider value={{ displayAudio }}>
      <HistoryDataProvider value={{ histSourceList }}>
        <DockLoudness controls={controls} />
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

  it("uses the normal panel's Momentary, Short-term, and Reference layer semantics", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ m: -30 + i * 0.1, st: -28 + i * 0.2 }));
    renderWith({
      displayAudio: { momentary: -18.2, shortTerm: -19.4, integrated: -20.1 },
      histSourceList: rows,
    });

    const momentary = screen.getByTestId("dock-loudness-momentary");
    const shortTerm = screen.getByTestId("dock-loudness-short-term");
    expect(momentary.getAttribute("stroke")).toMatch(/^url\(#/);
    expect(shortTerm.getAttribute("stroke")).toMatch(/^url\(#/);
    expect(document.querySelector("svg line")).toBeNull();
  });

  it("hides unselected history layers and disables the reference gradient", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ m: -30 + i * 0.1, st: -28 + i * 0.2 }));
    renderWith({
      displayAudio: { momentary: -18.2, shortTerm: -19.4, integrated: -20.1 },
      histSourceList: rows,
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
