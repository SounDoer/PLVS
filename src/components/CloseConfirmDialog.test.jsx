/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CloseConfirmDialog } from "./CloseConfirmDialog.jsx";

describe("CloseConfirmDialog", () => {
  it("renders nothing when open=false", () => {
    render(
      <CloseConfirmDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} onRetry={undefined} />
    );
    expect(screen.queryByText("Close Action")).toBeNull();
  });

  it("renders the Close Action select and Remember This Choice switch when open", () => {
    render(
      <CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} onRetry={undefined} />
    );
    expect(screen.getByText("Close Action")).toBeTruthy();
    expect(screen.getByText("Remember This Choice")).toBeTruthy();
    expect(screen.getByLabelText("close action")).toBeTruthy();
    expect(
      screen.getByRole("switch", { name: "remember this choice", checked: false })
    ).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Close PLVS?" })).toBeTruthy();
  });

  it("defaults to Quit selected", () => {
    render(
      <CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} onRetry={undefined} />
    );
    const trigger = screen.getByLabelText("close action");
    expect(trigger.textContent).toContain("Quit");
  });

  it("calls onCancel when Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(
      <CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={onCancel} onRetry={undefined} />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onConfirm('quit', false) when Quit is clicked with defaults", () => {
    const onConfirm = vi.fn();
    render(
      <CloseConfirmDialog
        open={true}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onRetry={undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    expect(onConfirm).toHaveBeenCalledWith("quit", false);
  });

  it("calls onConfirm with dontAskAgain=true when switch is toggled on", () => {
    const onConfirm = vi.fn();
    render(
      <CloseConfirmDialog
        open={true}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
        onRetry={undefined}
      />
    );
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    expect(onConfirm).toHaveBeenCalledWith("quit", true);
  });

  it("uses the selected close action as the primary button label", () => {
    const onConfirm = vi.fn();
    render(<CloseConfirmDialog open onConfirm={onConfirm} onCancel={vi.fn()} onRetry={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "close action" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "Minimize to Tray" }));
    fireEvent.click(screen.getByRole("button", { name: "Minimize to Tray" }));
    expect(onConfirm).toHaveBeenCalledWith("tray", false);
  });

  it("shows a persistence error with retry and cancel actions", () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    render(
      <CloseConfirmDialog
        open={true}
        error="The window was left open."
        onConfirm={vi.fn()}
        onRetry={onRetry}
        onCancel={onCancel}
      />
    );

    expect(screen.getByText("The window was left open.")).toBeTruthy();
    expect(screen.queryByLabelText("close action")).toBeNull();
    fireEvent.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
