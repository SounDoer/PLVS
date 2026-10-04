/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ResetAction } from "./ResetAction.jsx";

it("stays visible but disabled while the controlled values use defaults", () => {
  render(<ResetAction label="Reset layout" isDefault onReset={vi.fn()} />);

  const reset = screen.getByRole("button", { name: "Reset layout" });
  expect(reset.disabled).toBe(true);
  fireEvent.mouseEnter(reset.parentElement);
  expect(screen.getByRole("tooltip").textContent).toBe("Using Defaults");
});

it("requires inline confirmation before resetting", () => {
  const onReset = vi.fn();
  render(<ResetAction label="Reset layout" onReset={onReset} />);

  fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
  expect(onReset).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm reset layout" }));
  expect(onReset).toHaveBeenCalledTimes(1);
});

it("keeps the original trigger as the confirmation state's size reference", () => {
  render(<ResetAction label="Reset layout" onReset={vi.fn()} />);

  const reset = screen.getByRole("button", { name: "Reset layout" });
  const slot = reset.closest("[data-reset-action]");
  expect(slot.className).not.toContain("h-5");

  fireEvent.click(reset);
  const confirmation = screen.getByRole("button", { name: "Confirm reset layout" }).parentElement;
  expect(confirmation.className).toContain("absolute");
  expect(slot.querySelector("[data-inline-confirm-sizer]")).toBeTruthy();
  expect(confirmation.closest("[data-reset-action]")).toBe(slot);
});
