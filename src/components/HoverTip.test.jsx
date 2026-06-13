/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HoverTip } from "./HoverTip.jsx";

describe("HoverTip", () => {
  it("renders children and the tip text", () => {
    render(
      <HoverTip tip="Explain me">
        <button type="button">Child</button>
      </HoverTip>
    );
    expect(screen.getByRole("button", { name: "Child" })).toBeTruthy();
    expect(screen.getByText("Explain me")).toBeTruthy();
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
