/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyTextButton } from "./CopyTextButton.jsx";

const VALUE = "Use the available CLI, then help me...";

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn() },
  });
});

describe("CopyTextButton", () => {
  it("copies the complete value and reports success on the same action", async () => {
    render(<CopyTextButton value={VALUE} ariaLabel="copy prompt starter" />);

    const copy = screen.getByRole("button", { name: "copy prompt starter" });
    fireEvent.click(copy);

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(VALUE));
    expect(copy.getAttribute("data-copy-state")).toBe("copied");
    fireEvent.mouseEnter(copy.parentElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Copied");
  });

  it("reports failure on the same action when copying fails", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("clipboard unavailable")
    );
    render(<CopyTextButton value={VALUE} ariaLabel="copy prompt starter" />);

    const copy = screen.getByRole("button", { name: "copy prompt starter" });
    fireEvent.click(copy);

    await waitFor(() => expect(copy.getAttribute("data-copy-state")).toBe("failed"));
    fireEvent.mouseEnter(copy.parentElement);
    expect(screen.getByRole("tooltip").textContent).toBe("Copy Failed");
  });
});
