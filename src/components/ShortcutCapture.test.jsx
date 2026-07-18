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

  it("captures from the window on macOS when WKWebView leaves focus on the dialog", () => {
    const onChange = vi.fn();
    render(<ShortcutCapture value="CmdOrCtrl+K" onChange={onChange} isMac={true} />);
    const btn = screen.getByLabelText("Clear shortcut");

    fireEvent.click(btn);
    fireEvent.keyDown(window, { key: "j", metaKey: true });

    expect(onChange).toHaveBeenCalledWith("CmdOrCtrl+J");
    expect(btn.textContent).toBe("⌘K");
  });

  it("uses the same window capture path on Windows", () => {
    const onChange = vi.fn();
    render(<ShortcutCapture value="CmdOrCtrl+K" onChange={onChange} isMac={false} />);
    const btn = screen.getByLabelText("Clear shortcut");

    fireEvent.click(btn);
    fireEvent.keyDown(window, { key: "j", ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith("CmdOrCtrl+J");
    expect(btn.textContent).toBe("Ctrl+K");

    fireEvent.keyDown(window, { key: "m", ctrlKey: true });
    expect(onChange).toHaveBeenCalledTimes(1);
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

  it("accepts CmdOrCtrl+, now that Open Settings is not in the reserved list", () => {
    const onChange = vi.fn();
    render(<ShortcutCapture value="CmdOrCtrl+Alt+K" onChange={onChange} isMac={false} />);
    const btn = screen.getByLabelText("Clear shortcut");
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: ",", ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith("CmdOrCtrl+,");
  });

  it("signals recording start, and Escape cancels without changing", () => {
    const onChange = vi.fn();
    const onRecordingChange = vi.fn();
    render(
      <ShortcutCapture
        value="CmdOrCtrl+K"
        onChange={onChange}
        onRecordingChange={onRecordingChange}
        isMac={false}
      />
    );
    const btn = screen.getByLabelText("Clear shortcut");
    fireEvent.click(btn);
    expect(onRecordingChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(btn, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onRecordingChange).toHaveBeenLastCalledWith(false);
    expect(btn.textContent).toBe("Ctrl+K");
  });

  it("signals recording end after a successful capture", () => {
    const onRecordingChange = vi.fn();
    render(
      <ShortcutCapture
        value="CmdOrCtrl+K"
        onChange={vi.fn()}
        onRecordingChange={onRecordingChange}
        isMac={false}
      />
    );
    const btn = screen.getByLabelText("Clear shortcut");
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: "m", ctrlKey: true, altKey: true });
    expect(onRecordingChange).toHaveBeenLastCalledWith(false);
  });
});
