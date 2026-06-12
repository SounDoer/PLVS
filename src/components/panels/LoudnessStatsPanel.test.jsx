/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { LoudnessStatsPanel } from "./LoudnessStatsPanel.jsx";

const primaryMetrics = [
  { id: "momentary", label: "Momentary", value: "-20.0", unit: "LUFS" },
  { id: "shortTerm", label: "Short-term", value: "-18.0", unit: "LUFS" },
  { id: "integrated", label: "Integrated", value: "-19.0", unit: "LUFS" },
  { id: "lra", label: "Loudness Range (LRA)", value: "3.0", unit: "LU" },
];

const secondaryMetrics = [
  { id: "psr", label: "Dynamics (PSR)", value: "7.0", unit: "dB" },
  { id: "plr", label: "Avg. Dynamics (PLR)", value: "8.0", unit: "dB" },
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
    expect(screen.getByText("Dynamics (PSR)")).toBeTruthy();
    expect(screen.queryByText("Momentary")).toBeNull();
    expect(screen.queryByText("Short-term")).toBeNull();
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
