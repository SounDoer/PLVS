import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockControls } from "./DockControls.jsx";

function mockPlatform(platform) {
  vi.spyOn(window.navigator, "platform", "get").mockReturnValue(platform);
}

function renderControls(overrides = {}) {
  return render(
    <DockControls
      sourceTransportState={{ chromeState: "ready", primaryAction: "start" }}
      onSourceTransportAction={() => {}}
      onClear={() => {}}
      dockEdge="bottom"
      onDockEdgeChange={() => {}}
      onExitDock={() => {}}
      onEditModules={() => {}}
      onEditPresets={() => {}}
      {...overrides}
    />
  );
}

describe("DockControls reserve-space action", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the toggle on Windows and reports the next value", () => {
    mockPlatform("Win32");
    const onReserveSpaceChange = vi.fn();
    renderControls({ reserveSpace: false, onReserveSpaceChange });
    fireEvent.click(screen.getByRole("button", { name: "Reserve screen space" }));
    expect(onReserveSpaceChange).toHaveBeenCalledWith(true);
  });

  it("hides the toggle outside Windows", () => {
    mockPlatform("MacIntel");
    renderControls();
    expect(screen.queryByRole("button", { name: /reserving screen space/i })).toBeNull();
  });
});
