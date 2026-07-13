/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HoverTip } from "./HoverTip.jsx";

describe("HoverTip", () => {
  it("renders children and reveals the tip on hover", () => {
    render(
      <HoverTip tip="Explain me">
        <button type="button">Child</button>
      </HoverTip>
    );

    const child = screen.getByRole("button", { name: "Child" });
    expect(child).toBeTruthy();
    expect(screen.queryByText("Explain me")).toBeNull();

    fireEvent.mouseEnter(child);
    expect(screen.getByText("Explain me")).toBeTruthy();
  });

  it("portals the visible tip outside scrollable ancestors", () => {
    render(
      <HoverTip tip="Explain me">
        <button type="button">Child</button>
      </HoverTip>
    );

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Child" }));

    const tip = screen.getByRole("tooltip");
    expect(tip.parentElement).toBe(document.body);
    expect(tip.className).toContain("fixed");
  });

  it("keeps the visible tip inside the viewport", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 120 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 80 });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 80 });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 20 });
    render(
      <HoverTip tip="Explain me">
        <button type="button">Child</button>
      </HoverTip>
    );
    const child = screen.getByRole("button", { name: "Child" });
    child.parentElement.getBoundingClientRect = () => ({
      left: 0,
      right: 10,
      top: 10,
      bottom: 30,
      width: 10,
      height: 20,
      x: 0,
      y: 10,
      toJSON: () => {},
    });

    fireEvent.mouseEnter(child);

    expect(screen.getByRole("tooltip").style.left).toBe("8px");
  });

  it("renders children only when no tip is given", () => {
    render(
      <HoverTip>
        <span>Just me</span>
      </HoverTip>
    );
    expect(screen.getByText("Just me")).toBeTruthy();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
