/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyableTextBlock } from "./CopyableTextBlock.jsx";

const VALUE = "Use the available CLI, then help me...";

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn() },
  });
});

describe("CopyableTextBlock", () => {
  it("renders selectable read-only text with an icon-only copy action", () => {
    render(<CopyableTextBlock value={VALUE} ariaLabel="copy prompt starter" />);

    const text = screen.getByRole("textbox", { name: "copy prompt starter text" });
    expect(text.textContent).toBe(VALUE);
    expect(text.getAttribute("aria-readonly")).toBe("true");
    expect(screen.getByRole("button", { name: "copy prompt starter" }).textContent).toBe("");
  });

  it("copies the complete value and reports success on the same action", async () => {
    render(<CopyableTextBlock value={VALUE} ariaLabel="copy prompt starter" />);

    const copy = screen.getByRole("button", { name: "copy prompt starter" });
    fireEvent.click(copy);

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(VALUE));
    expect(copy.getAttribute("data-copy-state")).toBe("copied");
    fireEvent.mouseEnter(copy.parentElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Copied");
  });

  it("keeps the text available for manual selection when copying fails", async () => {
    navigator.clipboard.writeText.mockRejectedValueOnce(new Error("clipboard unavailable"));
    render(<CopyableTextBlock value={VALUE} ariaLabel="copy prompt starter" />);

    const copy = screen.getByRole("button", { name: "copy prompt starter" });
    fireEvent.click(copy);

    await waitFor(() => expect(copy.getAttribute("data-copy-state")).toBe("failed"));
    expect(screen.getByRole("textbox").textContent).toBe(VALUE);
    fireEvent.mouseEnter(copy.parentElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Copy Failed");
  });
});
