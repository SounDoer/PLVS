/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { LoudnessStatsPanel } from "./LoudnessStatsPanel.jsx";

const primaryMetrics = [
  {
    id: "momentary",
    label: "Momentary",
    value: "-20.0",
    unit: "LUFS",
    hint: "Loudness over a 400ms window",
  },
  {
    id: "shortTerm",
    label: "Short-term",
    value: "-18.0",
    unit: "LUFS",
    hint: "Loudness over a 3s window",
  },
  {
    id: "integrated",
    label: "Integrated",
    value: "-19.0",
    unit: "LUFS",
    hint: "Loudness over the whole program, gated below −70 LUFS",
  },
  {
    id: "lra",
    label: "Loudness Range",
    value: "3.0",
    unit: "LU",
    hint: "LRA, loudness range over the whole program",
  },
];

const secondaryMetrics = [
  {
    id: "psr",
    label: "Short-term Dynamics",
    value: "7.0",
    unit: "dB",
    hint: "PSR, Peak to Short-term loudness Ratio",
  },
  {
    id: "plr",
    label: "Integrated Dynamics",
    value: "8.0",
    unit: "dB",
    hint: "PLR, Peak to Loudness Ratio",
  },
];

function renderPanel(visibleIds) {
  return render(
    <AudioDataContext.Provider
      value={{
        primaryMetrics,
        secondaryMetrics,
        loudnessStatsVisibleIds: visibleIds,
      }}
    >
      <LoudnessStatsPanel />
    </AudioDataContext.Provider>
  );
}

describe("LoudnessStatsPanel", () => {
  it("renders only visible stats", () => {
    renderPanel(["integrated", "psr"]);

    expect(screen.getByText("Integrated")).toBeTruthy();
    expect(screen.getByText("Short-term Dynamics")).toBeTruthy();
    expect(screen.queryByText("Momentary")).toBeNull();
    expect(screen.queryByText("Short-term")).toBeNull();
  });

  it("exposes the hover hint for a visible metric", () => {
    renderPanel(["integrated"]);

    expect(screen.getByText("Loudness over the whole program, gated below −70 LUFS")).toBeTruthy();
  });

  it("renders an empty state when no stats are selected", () => {
    renderPanel([]);

    expect(screen.getByText("No stats selected")).toBeTruthy();
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

  it("shows an active speaking-now dot when dialogueCoverage is visible and dialogueActiveNow is true", () => {
    render(
      <AudioDataContext.Provider
        value={{
          primaryMetrics: [
            { id: "dialogueCoverage", label: "Dialogue Coverage", value: "62", unit: "%" },
          ],
          secondaryMetrics: [],
          loudnessStatsVisibleIds: ["dialogueCoverage"],
          dialogueActiveNow: true,
        }}
      >
        <LoudnessStatsPanel />
      </AudioDataContext.Provider>
    );

    expect(screen.getByTestId("dialogue-active-dot").getAttribute("data-active")).toBe("true");
  });
});
