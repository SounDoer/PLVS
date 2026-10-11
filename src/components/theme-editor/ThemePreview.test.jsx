/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_THEMES_V2 } from "../../theme/builtinThemesV2.js";
import { ThemePreview } from "./ThemePreview.jsx";

describe("ThemePreview", () => {
  it("previews Live and Snapshot as states of the same theme", () => {
    render(
      <ThemePreview draft={BUILTIN_THEMES_V2["plvs-dark"]} onClose={vi.fn()} onJump={vi.fn()} />
    );

    expect(document.querySelector("[data-history]")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Snapshot" }));
    expect(document.querySelector("[data-history]")).toBeTruthy();
  });
});
