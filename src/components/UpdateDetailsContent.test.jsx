/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UpdateDetailsContent } from "./UpdateDetailsContent.jsx";

function props(overrides = {}) {
  return {
    releaseNotes: "### Changes\n- Offline update support",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    onRestart: vi.fn(),
    openExternalUrl: vi.fn(),
    ...overrides,
  };
}

describe("shared update details", () => {
  it("renders without a dialog or application provider and skips a ready update without installing", () => {
    const callbacks = props({ ready: true });
    render(<UpdateDetailsContent {...callbacks} />);
    expect(screen.getByRole("heading", { name: "Changes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Skip This Time" }));
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(callbacks.onConfirm).not.toHaveBeenCalled();
    expect(callbacks.onRestart).not.toHaveBeenCalled();
  });

  it("uses the host confirmation callback and locks both actions during installation", () => {
    const callbacks = props();
    const view = render(<UpdateDetailsContent {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Update and Restart" }));
    expect(callbacks.onConfirm).toHaveBeenCalledTimes(1);
    view.rerender(<UpdateDetailsContent {...callbacks} installStatus="installing" />);
    fireEvent.click(screen.getByRole("button", { name: "Updating..." }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(callbacks.onConfirm).toHaveBeenCalledTimes(1);
    expect(callbacks.onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("progressbar").hasAttribute("aria-valuenow")).toBe(false);
  });

  it("delegates restart retry without starting another installation", () => {
    const callbacks = props({ installStatus: "restart-error" });
    render(<UpdateDetailsContent {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(callbacks.onRestart).toHaveBeenCalledTimes(1);
    expect(callbacks.onConfirm).not.toHaveBeenCalled();
  });

  it("does not offer a manual download without an exact public release URL", () => {
    render(<UpdateDetailsContent {...props({ installStatus: "install-error" })} />);
    expect(screen.queryByRole("button", { name: "Download Manually" })).toBeNull();
  });
});
