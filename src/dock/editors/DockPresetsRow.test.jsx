/** @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockPresetsRow } from "./DockPresetsRow.jsx";

const PRESETS = {
  list: [
    { id: "p1", name: "Mix" },
    { id: "p2", name: "Dock check" },
  ],
  activeId: "p2",
  dirty: false,
  apply: vi.fn(),
  save: vi.fn(),
};

describe("DockPresetsRow", () => {
  it("renders preset chips and applies on click", () => {
    render(<DockPresetsRow presets={PRESETS} />);
    fireEvent.click(screen.getByRole("button", { name: /apply preset mix/i }));
    expect(PRESETS.apply).toHaveBeenCalledWith("p1");
  });

  it("saves a new preset from the inline input", () => {
    render(<DockPresetsRow presets={PRESETS} />);
    fireEvent.change(screen.getByLabelText(/new preset name/i), {
      target: { value: "Strip" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(PRESETS.save).toHaveBeenCalledWith("Strip");
  });
});
