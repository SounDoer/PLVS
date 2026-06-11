/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShortcutCapture } from "./ShortcutCapture.jsx";

describe("ShortcutCapture", () => {
  it("shows the formatted current value", () => {
    render(<ShortcutCapture value="CmdOrCtrl+Alt+K" onChange={vi.fn()} isMac={false} />);
    expect(screen.getByLabelText("Clear shortcut").textContent).toBe("Ctrl+Alt+K");
  });

  it("captures a valid combo and calls onChange", () => {
    const onChange = vi.fn();
    render(<ShortcutCapture value="CmdOrCtrl+Alt+K" onChange={onChange} isMac={false} />);
    const btn = screen.getByLabelText("Clear shortcut");
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "j", ctrlKey: true, altKey: true });
    expect(onChange).toHaveBeenCalledWith("CmdOrCtrl+Alt+J");
  });

  it("rejects a combo with no modifier and shows a hint", () => {
    const onChange = vi.fn();
    render(<ShortcutCapture value="CmdOrCtrl+Alt+K" onChange={onChange} isMac={false} />);
    const btn = screen.getByLabelText("Clear shortcut");
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "a" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/needs a modifier/i)).toBeTruthy();
  });
});
