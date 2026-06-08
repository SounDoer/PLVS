/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CloseConfirmDialog } from "./CloseConfirmDialog.jsx";

describe("CloseConfirmDialog", () => {
  it("renders nothing when open=false", () => {
    render(<CloseConfirmDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText("Close PLVS")).toBeNull();
  });

  it("renders dialog title when open=true", () => {
    render(<CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Close PLVS")).toBeTruthy();
  });

  it("shows both options", () => {
    render(<CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Minimize to tray")).toBeTruthy();
    expect(screen.getByText("Quit")).toBeTruthy();
  });

  it("defaults to Minimize to tray selected", () => {
    render(<CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const radios = screen.getAllByRole("radio");
    expect(radios[0].checked).toBe(true);
    expect(radios[1].checked).toBe(false);
  });

  it("calls onCancel when Cancel button is clicked", () => {
    const onCancel = vi.fn();
    render(<CloseConfirmDialog open={true} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onConfirm('tray', false) when Confirm clicked with defaults", () => {
    const onConfirm = vi.fn();
    render(<CloseConfirmDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith("tray", false);
  });

  it("calls onConfirm('quit', false) when Quit is selected then Confirm clicked", () => {
    const onConfirm = vi.fn();
    render(<CloseConfirmDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getAllByRole("radio")[1]);
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith("quit", false);
  });

  it("calls onConfirm with dontAskAgain=true when checkbox is checked", () => {
    const onConfirm = vi.fn();
    render(<CloseConfirmDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Confirm"));
    expect(onConfirm).toHaveBeenCalledWith("tray", true);
  });
});
