/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { InlineConfirm } from "./InlineConfirm.jsx";

function setup(onConfirm = vi.fn()) {
  render(
    <InlineConfirm
      onConfirm={onConfirm}
      confirmLabel="Confirm action"
      cancelLabel="Cancel action"
      trigger={(arm) => (
        <button type="button" onClick={arm}>
          Reset
        </button>
      )}
    />
  );
  return { onConfirm };
}

function TriggerWithoutForwardRef({ arm }) {
  return (
    <button type="button" onClick={arm}>
      Reset
    </button>
  );
}

function setupWithoutForwardRef(onConfirm = vi.fn()) {
  render(
    <InlineConfirm
      onConfirm={onConfirm}
      confirmLabel="Confirm action"
      cancelLabel="Cancel action"
      trigger={(arm) => <TriggerWithoutForwardRef arm={arm} />}
    />
  );
  return { onConfirm };
}

describe("InlineConfirm", () => {
  it("shows only the trigger when idle", () => {
    setup();
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
    expect(screen.queryByLabelText("Confirm action")).toBeNull();
  });

  it("arms on trigger click without calling onConfirm", () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Confirm action")).toBeTruthy();
    expect(screen.getByLabelText("Cancel action")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders cancel before confirm in DOM order", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(
      screen.getAllByRole("button").map((button) => button.getAttribute("aria-label"))
    ).toEqual(["Cancel action", "Confirm action"]);
  });

  it("moves focus to cancel when the trigger is replaced", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(document.activeElement).toBe(screen.getByLabelText("Cancel action"));
  });

  it("calls onConfirm and returns to idle on confirm", () => {
    const { onConfirm } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    fireEvent.click(screen.getByLabelText("Confirm action"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy();
  });

  it("returns to idle on cancel without calling onConfirm", () => {
    const { onConfirm } = setup();
    const trigger = screen.getByRole("button", { name: "Reset" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByLabelText("Cancel action"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset" }));
  });

  it("disarms on Escape without calling onConfirm", () => {
    const { onConfirm } = setup();
    const trigger = screen.getByRole("button", { name: "Reset" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset" }));
  });

  it.each([
    ["cancel", () => fireEvent.click(screen.getByLabelText("Cancel action"))],
    ["Escape", () => fireEvent.keyDown(window, { key: "Escape" })],
  ])("restores focus to a non-forwardRef trigger after %s", (_action, disarm) => {
    setupWithoutForwardRef();
    const trigger = screen.getByRole("button", { name: "Reset" });
    trigger.focus();
    fireEvent.click(trigger);

    disarm();

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset" }));
  });
});
