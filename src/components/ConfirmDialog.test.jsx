/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog.jsx";

function setup(overrides = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Reset PLVS to Default?"
      description="Everything is erased."
      confirmLabel="Reset PLVS"
      onConfirm={onConfirm}
      {...overrides}
    />
  );
  return { onConfirm, onOpenChange };
}

describe("ConfirmDialog", () => {
  it("shows the title and description as an alertdialog", () => {
    setup();
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Reset PLVS to Default?");
    expect(dialog.textContent).toContain("Everything is erased.");
  });

  it("runs nothing until the destructive button is pressed", () => {
    const { onConfirm } = setup();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset PLVS" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // The dialog closes itself before handing control over, so a confirm handler that unmounts its
  // own owner cannot leave an orphaned open dialog behind.
  it("closes before running the confirm handler", () => {
    const order = [];
    const onOpenChange = vi.fn((next) => order.push(`open:${next}`));
    const onConfirm = vi.fn(() => order.push("confirm"));
    setup({ onOpenChange, onConfirm });
    fireEvent.click(screen.getByRole("button", { name: "Reset PLVS" }));
    expect(order).toEqual(["open:false", "confirm"]);
  });

  it("dismisses without confirming", () => {
    const { onConfirm, onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("takes a custom dismiss label", () => {
    setup({ cancelLabel: "Keep Editing" });
    expect(screen.getByRole("button", { name: "Keep Editing" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("renders nothing while closed", () => {
    setup({ open: false });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
