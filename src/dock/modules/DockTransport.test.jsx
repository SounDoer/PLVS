import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DockTransport } from "./DockTransport.jsx";

describe("DockTransport", () => {
  it("renders only the current timer without transport controls", () => {
    render(
      <DockTransport
        controls={{
          sourceTransportState: {
            statusLabel: "01:23",
            actionLabel: "STOP",
          },
        }}
      />
    );
    expect(screen.getByTestId("dock-transport-timer").textContent).toBe("01:23");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("STOP")).toBeNull();
  });

  it("shows a zero timer while capture is ready", () => {
    render(<DockTransport controls={{ sourceTransportState: { statusLabel: "Ready" } }} />);
    expect(screen.getByText("00:00")).toBeTruthy();
  });

  it("renders nothing without timer state", () => {
    const { container } = render(<DockTransport />);
    expect(container.firstChild).toBeNull();
  });
});
