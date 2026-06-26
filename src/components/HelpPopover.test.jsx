/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpPopover } from "./HelpPopover.jsx";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("HelpPopover", () => {
  it("renders the trigger button", () => {
    render(<HelpPopover items={["Scroll wheel to zoom"]} />);
    expect(screen.getByRole("button", { name: /shortcuts/i })).toBeTruthy();
  });

  it("popover content is not visible before trigger click", () => {
    render(<HelpPopover items={["Scroll wheel to zoom"]} />);
    expect(screen.queryByText("Scroll wheel to zoom")).toBeNull();
  });

  it("shows item text after trigger click", () => {
    render(<HelpPopover items={["Scroll wheel to zoom"]} />);
    fireEvent.click(screen.getByRole("button", { name: /shortcuts/i }));
    expect(screen.getByText("Scroll wheel to zoom")).toBeTruthy();
  });

  it("renders multiple items", () => {
    render(<HelpPopover items={["Left click to select", "Right click to pan"]} />);
    fireEvent.click(screen.getByRole("button", { name: /shortcuts/i }));
    expect(screen.getByText("Left click to select")).toBeTruthy();
    expect(screen.getByText("Right click to pan")).toBeTruthy();
  });

  it("renders grouped items with headings", () => {
    render(
      <HelpPopover
        items={[
          { title: "Snapshot", items: ["Left click - Select snapshot"] },
          { title: "Viewport", items: ["Ctrl + wheel - Zoom Y"] },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /shortcuts/i }));
    expect(screen.getByText("Snapshot")).toBeTruthy();
    expect(screen.getByText("Viewport")).toBeTruthy();
    expect(screen.getByText("Ctrl + wheel - Zoom Y")).toBeTruthy();
  });

  it("uses the left mouse icon for drag gestures unless right is specified", () => {
    render(
      <HelpPopover
        items={[
          "Ctrl + drag - Pan viewport",
          "Time axis drag - Pan time",
          "Y axis drag - Pan level",
          "Right drag - Pan timeline",
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /shortcuts/i }));

    expect(document.querySelectorAll('[data-gesture-icon="left-mouse"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-gesture-icon="right-mouse"]')).toHaveLength(1);
  });

  it("uses hover and left mouse icons for inspect click gestures", () => {
    render(
      <HelpPopover
        items={[
          "Hover - Inspect value",
          "Click - Capture snapshot",
          "Double-click - Return to live",
          "Double-click axis - Reset axis",
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /shortcuts/i }));

    expect(document.querySelectorAll('[data-gesture-icon="hover"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-gesture-icon="left-mouse"]')).toHaveLength(3);
  });

  it("renders an empty list without error", () => {
    render(<HelpPopover items={[]} />);
    expect(screen.getByRole("button")).toBeTruthy();
  });
});
