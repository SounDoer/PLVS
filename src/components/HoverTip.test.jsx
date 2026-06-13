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
