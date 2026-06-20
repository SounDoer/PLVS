/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeEditor } from "./ThemeEditor.jsx";
import { makeCustomThemeFromBase } from "../theme/customTheme.js";
import { BUILTIN_THEMES } from "../theme/builtinThemes.js";

const DRAFT = makeCustomThemeFromBase(BUILTIN_THEMES["plvs-dark"], "My Theme", () => "custom-1");

const BASE_PROPS = {
  draft: DRAFT,
  onName: vi.fn(),
  onSeed: vi.fn(),
  onShell: vi.fn(),
  onSave: vi.fn(),
  onCancel: vi.fn(),
  dirty: false,
  pos: { x: 10, y: 20 },
  onMove: vi.fn(),
};

describe("ThemeEditor", () => {
  it("does not show the custom theme color scheme in the title bar", () => {
    render(<ThemeEditor {...BASE_PROPS} />);

    const dialog = screen.getByRole("dialog", { name: "Theme editor" });

    expect(dialog.textContent).not.toContain("dark");
    expect(dialog.textContent).not.toContain("light");
  });

  it("uses an app dialog when cancelling dirty edits", () => {
    const onCancel = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm");

    render(<ThemeEditor {...BASE_PROPS} dirty={true} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Discard theme changes?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog", { name: "Discard theme changes?" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    confirmSpy.mockRestore();
  });
});
