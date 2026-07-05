/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColorControl } from "./ColorControl.jsx";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("ColorControl", () => {
  it("shows the current color and emits hex at full alpha", () => {
    const onChange = vi.fn();
    render(<ColorControl label="Accent" value="#fb923c" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /accent/i }));
    fireEvent.input(screen.getByLabelText(/hex/i), { target: { value: "#22d3ee" } });
    expect(onChange).toHaveBeenLastCalledWith("#22d3ee");
  });
  it("emits rgba when alpha < 1", () => {
    const onChange = vi.fn();
    render(<ColorControl label="Border" value="#ffffff" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /border/i }));
    fireEvent.input(screen.getByLabelText(/alpha/i), { target: { value: "0.5" } });
    expect(onChange).toHaveBeenLastCalledWith("rgba(255, 255, 255, 0.5)");
  });

  it("uses the custom range style for alpha", () => {
    render(<ColorControl label="Border" value="rgba(255, 255, 255, 0.5)" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /border/i }));

    const alphaRange = screen.getByLabelText(/alpha/i);

    expect(alphaRange.classList.contains("plvs-range")).toBe(true);
    expect(alphaRange.style.getPropertyValue("--range-pct")).toBe("50%");
  });
});
