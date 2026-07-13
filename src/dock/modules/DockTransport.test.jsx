import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockTransport } from "./DockTransport.jsx";

const CONTROLS = {
  sourceTransportState: {
    chromeState: "ready",
    sourceLabel: "Live",
    statusLabel: "00:00",
    actionLabel: "START",
    actionKind: "start",
    primaryActionDisabled: false,
  },
  onSourceTransportAction: vi.fn(),
};

describe("DockTransport", () => {
  it("renders the locked transport pill and forwards the primary action", () => {
    render(<DockTransport controls={CONTROLS} />);
    // locked: no source popover trigger
    expect(screen.queryByRole("button", { name: /source:/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    expect(CONTROLS.onSourceTransportAction).toHaveBeenCalledWith("start");
  });

  it("renders nothing without controls (defensive)", () => {
    const { container } = render(<DockTransport />);
    expect(container.firstChild).toBeNull();
  });
});
