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

  it("lets the hex field shrink instead of overflowing the popover", () => {
    render(<ColorControl label="Accent" value="#fb923c" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /accent/i }));

    // A text input's intrinsic width beats `flex-1` unless min-width is cleared.
    expect(screen.getByLabelText(/hex/i).classList.contains("min-w-0")).toBe(true);
    expect(screen.getByLabelText(/alpha/i).classList.contains("min-w-0")).toBe(true);
  });

  it("carries its own focus ring instead of the UA outline", () => {
    render(<ColorControl label="Accent" value="#fb923c" onChange={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: /accent/i });
    expect(trigger.className).toContain("focus-visible:ring-ring");
    expect(trigger.className).toContain("focus-visible:outline-none");
    // ...but not while its own panel is open.
    expect(trigger.className).toContain("data-[state=open]:focus-visible:ring-0");
  });

  it("uses the custom range style for alpha", () => {
    render(<ColorControl label="Border" value="rgba(255, 255, 255, 0.5)" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /border/i }));

    const alphaRange = screen.getByLabelText(/alpha/i);

    expect(alphaRange.classList.contains("plvs-range")).toBe(true);
    expect(alphaRange.style.getPropertyValue("--range-pct")).toBe("50%");
  });

  it("refreshes the editable value when a preset changes the controlled color", () => {
    const { rerender } = render(<ColorControl label="Accent" value="#fb923c" onChange={vi.fn()} />);
    rerender(<ColorControl label="Accent" value="#22d3ee" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /accent/i }));

    expect(screen.getByLabelText(/hex/i).value).toBe("#22d3ee");
  });

  it("accepts pasted RGB and OKLCH while preserving incomplete text", () => {
    const onChange = vi.fn();
    render(<ColorControl label="Accent" value="#fb923c" onChange={onChange} allowAlpha={false} />);
    fireEvent.click(screen.getByRole("button", { name: /accent/i }));
    const text = screen.getByLabelText("Accent hex");

    fireEvent.input(text, { target: { value: "#12" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(text.value).toBe("#12");

    fireEvent.input(text, { target: { value: "rgb(34 211 238)" } });
    expect(onChange).toHaveBeenLastCalledWith("#22d3ee");

    fireEvent.input(text, { target: { value: "oklch(0.8 0.1 200)" } });
    expect(onChange.mock.calls.at(-1)[0]).toMatch(/^#[0-9a-f]{6}$/);
  });
});
