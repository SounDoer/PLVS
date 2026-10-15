/** @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { DockTimelinePanel } from "./DockTimelinePanel.jsx";
import { HistoryDataProvider, useHistoryData } from "../../workspace/AudioDataContext.jsx";
function Probe() {
  const h = useHistoryData();
  return (
    <button
      onClick={() => {
        h.setHistoryWindowSec(20);
        h.setHistoryOffsetSec(7);
      }}
    >
      Edit Range
    </button>
  );
}
it.each([true, false])(
  "commits paired time edits without losing either value (linked=%s)",
  (linked) => {
    const setHistoryWindowSec = vi.fn(),
      setHistoryOffsetSec = vi.fn(),
      onDockPanelControlsChange = vi.fn();
    render(
      <HistoryDataProvider
        value={{
          historyWindowSec: 30,
          historyOffsetSec: 5,
          histSourceList: [],
          setHistoryWindowSec,
          setHistoryOffsetSec,
        }}
      >
        <DockTimelinePanel
          moduleId="waveform"
          component={Probe}
          controls={{
            panelId: "wave",
            linkTimeViewport: linked,
            historyWindowSec: 12,
            historyOffsetSec: 4,
            onDockPanelControlsChange,
          }}
        />
      </HistoryDataProvider>
    );
    fireEvent.click(screen.getByText("Edit Range"));
    if (linked) {
      expect(setHistoryWindowSec).toHaveBeenLastCalledWith(20);
      expect(setHistoryOffsetSec).toHaveBeenLastCalledWith(7);
      expect(onDockPanelControlsChange).not.toHaveBeenCalled();
    } else {
      expect(onDockPanelControlsChange).toHaveBeenLastCalledWith(
        "wave",
        expect.objectContaining({ historyWindowSec: 20, historyOffsetSec: 7 })
      );
      expect(setHistoryWindowSec).not.toHaveBeenCalled();
      expect(setHistoryOffsetSec).not.toHaveBeenCalled();
    }
  }
);
