/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  HistoryDataProvider,
  useHistoryData,
  usePanelInstanceData,
} from "../../workspace/AudioDataContext.jsx";
import { DockSpectrogram } from "./DockSpectrogram.jsx";
vi.mock("../../components/panels/SpectrogramPanel.jsx", () => ({
  SpectrogramPanel: ({ showAxes }) => {
    const history = useHistoryData();
    const { panelControls } = usePanelInstanceData();
    return (
      <output data-testid="shared" data-axes={String(showAxes)}>
        {JSON.stringify({
          windowSec: history.clampedWindowSec,
          controls: panelControls,
          selectedOffset: history.selectedOffset,
        })}
      </output>
    );
  },
}));
function mount(controls) {
  return render(
    <HistoryDataProvider
      value={{ historyWindowSec: 30, historyOffsetSec: 0, selectedOffset: 2, histSourceList: [] }}
    >
      <DockSpectrogram controls={controls} />
    </HistoryDataProvider>
  );
}
describe("DockSpectrogram", () => {
  it("uses the shared panel with axes by default and retains snapshot state", () => {
    mount({});
    expect(screen.getByTestId("shared").dataset.axes).toBe("true");
    expect(JSON.parse(screen.getByTestId("shared").textContent).selectedOffset).toBe(2);
  });
  it("uses the shared time window by default and keeps an unlinked local window", () => {
    const view = mount({ linkTimeViewport: false, historyWindowSec: 12, historyOffsetSec: 0 });
    expect(JSON.parse(screen.getByTestId("shared").textContent).windowSec).toBe(12);
    view.unmount();
    mount({ historyWindowSec: 12 });
    expect(JSON.parse(screen.getByTestId("shared").textContent).windowSec).toBe(30);
  });
});
