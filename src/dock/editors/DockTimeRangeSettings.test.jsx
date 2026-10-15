/** @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { DockTimeRangeSettings } from "./DockTimeRangeSettings.jsx";
function mount(linked = true) {
  const onChange = vi.fn(),
    onSharedTimeChange = vi.fn();
  const controls = { linkTimeViewport: linked, historyWindowSec: 12, historyOffsetSec: 4 };
  render(
    <DockTimeRangeSettings
      controls={controls}
      sharedTimeViewport={{ windowSec: 30, offsetSec: 6, maxWindowSec: 120, totalSamples: 1200 }}
      onChange={onChange}
      onSharedTimeChange={onSharedTimeChange}
    />
  );
  return { onChange, onSharedTimeChange };
}
it("copies the visible shared window and offset when unlinking", () => {
  const { onChange, onSharedTimeChange } = mount();
  fireEvent.click(screen.getByLabelText("link time range"));
  expect(onChange).toHaveBeenCalledWith({
    linkTimeViewport: false,
    historyWindowSec: 30,
    historyOffsetSec: 6,
  });
  expect(onSharedTimeChange).not.toHaveBeenCalled();
});
it.each([true, false])("routes range edits to the correct owner when linked=%s", (linked) => {
  const { onChange, onSharedTimeChange } = mount(linked);
  const input = screen.getByLabelText("time range min");
  fireEvent.change(input, { target: { value: "50" } });
  fireEvent.blur(input);
  expect(linked ? onSharedTimeChange : onChange).toHaveBeenCalled();
  expect(linked ? onChange : onSharedTimeChange).not.toHaveBeenCalled();
});
