/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CloseConfirmDialog } from "./CloseConfirmDialog.jsx";

describe("CloseConfirmDialog", () => {
  it("renders nothing when open=false", () => {
    render(<CloseConfirmDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText("Close Behavior")).toBeNull();
  });

  it("renders Close Behavior select and Don't ask again switch when open=true", () => {
    render(<CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Close behavior")).toBeTruthy();
    expect(screen.getByRole("switch", { name: /don't ask again/i })).toBeTruthy();
  });

  it("defaults to Quit selected", () => {
    render(<CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const trigger = screen.getByLabelText("Close behavior");
    expect(trigger.textContent).toContain("Quit");
  });

  it("calls onCancel when Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onConfirm('quit', false) when Confirm clicked with defaults", () => {
    const onConfirm = vi.fn();
    render(<CloseConfirmDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith("quit", false);
  });

  it("calls onConfirm with dontAskAgain=true when switch is toggled on", () => {
    const onConfirm = vi.fn();
    render(<CloseConfirmDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith("quit", true);
  });
});
