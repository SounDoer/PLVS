/** @vitest-environment jsdom */
import { afterEach, describe, it, expect, beforeEach, vi } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HelpPopover } from "./HelpPopover.jsx";
import { resolvePanelHelpItems } from "./panels/chartHelp.js";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => vi.useRealTimers());

const help = () => screen.getByRole("dialog", { name: "Panel gestures" });
const trigger = () => screen.getByRole("button", { name: "Shortcuts and gestures" });
const spectrum = (controls = {}, context = {}) =>
  resolvePanelHelpItems("spectrum", controls, context);

describe("HelpPopover", () => {
  it("starts closed and previews on hover without pinning", () => {
    render(<HelpPopover items={spectrum()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.mouseEnter(trigger());
    expect(help()).toBeTruthy();
    expect(trigger().getAttribute("aria-pressed")).toBe("false");
  });

  it("allows crossing the gap to read and scroll, then closes after pointer exit", () => {
    vi.useFakeTimers();
    render(<HelpPopover items={spectrum()} />);
    fireEvent.mouseEnter(trigger());
    fireEvent.mouseLeave(trigger());
    act(() => vi.advanceTimersByTime(100));
    fireEvent.mouseEnter(help());
    act(() => vi.advanceTimersByTime(300));
    expect(help()).toBeTruthy();
    fireEvent.mouseLeave(help());
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pins a preview on its first click, cancels pending close, and toggles closed on its next click", () => {
    vi.useFakeTimers();
    render(<HelpPopover items={spectrum()} />);
    fireEvent.mouseEnter(trigger());
    fireEvent.mouseLeave(trigger());
    fireEvent.click(trigger());
    expect(trigger().getAttribute("aria-pressed")).toBe("true");
    fireEvent.mouseLeave(help());
    act(() => vi.advanceTimersByTime(500));
    expect(help()).toBeTruthy();
    fireEvent.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger().getAttribute("aria-pressed")).toBe("false");
  });

  it("focuses pinned content for keyboard scrolling and handles Escape before its parent", async () => {
    const parentKeyDown = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <HelpPopover items={spectrum()} />
      </div>
    );
    fireEvent.click(trigger());
    expect(document.activeElement).toBe(help());
    fireEvent.keyDown(help(), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(parentKeyDown).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger()));
  });

  it("dismisses pinned help on an outside pointer click", async () => {
    render(<HelpPopover items={spectrum()} />);
    fireEvent.click(trigger());
    // Radix installs its document pointer listener on the next task.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.pointerDown(document.body, { button: 0 });
    fireEvent.pointerUp(document.body, { button: 0 });
    fireEvent.click(document.body, { button: 0 });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dismisses on window blur", () => {
    render(<HelpPopover items={spectrum()} />);
    fireEvent.click(trigger());
    fireEvent.blur(window);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("updates pinned content in place and clears its pin if the final gesture disappears", () => {
    const { rerender } = render(<HelpPopover items={spectrum({ spectrumMaxMode: "hold" })} />);
    fireEvent.click(trigger());
    expect(screen.getByText("Clear Max Hold")).toBeTruthy();
    rerender(<HelpPopover items={spectrum({ spectrumMaxMode: "hold" }, { isSnapshot: true })} />);
    expect(screen.queryByText("Clear Max Hold")).toBeNull();
    expect(screen.queryByText("Slow Trace")).toBeNull();
    expect(trigger().getAttribute("aria-pressed")).toBe("true");
    rerender(<HelpPopover items={[]} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<HelpPopover items={spectrum()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger().getAttribute("aria-pressed")).toBe("false");
  });

  it("renders modifiers once and uses explicit gesture metadata rather than effect text", () => {
    render(
      <HelpPopover
        items={[
          {
            title: "Viewport",
            items: [
              {
                id: "wheel",
                gesture: "wheel",
                modifiers: ["Shift"],
                target: "",
                effect: "Adjust Height Scale",
              },
              {
                id: "drag",
                gesture: "left-drag",
                modifiers: ["Ctrl"],
                target: "Time Axis",
                effect: "Move Right",
              },
              { id: "right", gesture: "right-drag", modifiers: [], target: "", effect: "Rotate" },
              {
                id: "swipe",
                gesture: "trackpad-swipe",
                modifiers: [],
                target: "",
                effect: "Pan Frequency",
              },
            ],
          },
        ]}
      />
    );
    fireEvent.click(trigger());
    expect(screen.getAllByText("Shift")).toHaveLength(1);
    expect(screen.getAllByText("Ctrl")).toHaveLength(1);
    expect(screen.getByText("Time Axis · Left Drag")).toBeTruthy();
    expect(screen.queryByText("Time Axis", { exact: true })).toBeNull();
    expect(screen.getByRole("heading", { name: "Viewport" })).toBeTruthy();
    expect(document.querySelector('[data-gesture-icon="left-drag"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-icon="right-drag"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-icon="wheel"]')).toBeTruthy();
    expect(document.querySelector('[data-gesture-icon="trackpad-swipe"]')).toBeTruthy();
    expect(screen.getAllByRole("term")).toHaveLength(4);
    expect(screen.getAllByRole("definition")).toHaveLength(4);
  });

  it("does not bubble help scrolling into chart or workspace handlers", () => {
    const onWheel = vi.fn();
    render(
      <div onWheel={onWheel}>
        <HelpPopover items={spectrum()} />
      </div>
    );
    fireEvent.click(trigger());
    fireEvent.wheel(help(), { deltaY: 100 });
    expect(onWheel).not.toHaveBeenCalled();
  });
});
