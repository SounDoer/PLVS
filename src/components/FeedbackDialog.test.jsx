/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeedbackDialog } from "./FeedbackDialog.jsx";

vi.mock("@/lib/feedback.js", () => ({
  submitFeedback: vi.fn(),
}));

import { submitFeedback } from "@/lib/feedback.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("FeedbackDialog", () => {
  it("disables submit until content is entered", () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Send" }).disabled).toBe(true);
    fireEvent.input(screen.getByLabelText("Feedback content"), {
      target: { value: "Great app!" },
    });
    expect(screen.getByRole("button", { name: "Send" }).disabled).toBe(false);
  });

  it("blocks submit and shows an inline error for a malformed email", () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Feedback content"), {
      target: { value: "Great app!" },
    });
    fireEvent.input(screen.getByLabelText("Your email (optional)"), {
      target: { value: "nope" },
    });
    fireEvent.blur(screen.getByLabelText("Your email (optional)"));
    expect(screen.getByText("Enter a valid email or leave it blank.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" }).disabled).toBe(true);
  });

  it("submits content and email, shows success, and closes after a delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    submitFeedback.mockResolvedValue(true);
    const onClose = vi.fn();
    render(<FeedbackDialog onClose={onClose} />);

    fireEvent.input(screen.getByLabelText("Feedback content"), {
      target: { value: "Great app!" },
    });
    fireEvent.input(screen.getByLabelText("Your email (optional)"), {
      target: { value: "a@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith({
        content: "Great app!",
        email: "a@example.com",
      })
    );
    expect(await screen.findByText("Thanks! Feedback sent.")).toBeTruthy();

    vi.advanceTimersByTime(2000);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("shows a failure message and preserves input when the request fails", async () => {
    submitFeedback.mockResolvedValue(false);
    render(<FeedbackDialog onClose={vi.fn()} />);

    fireEvent.input(screen.getByLabelText("Feedback content"), {
      target: { value: "Great app!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Failed to send, please try again.")).toBeTruthy();
    expect(screen.getByLabelText("Feedback content").value).toBe("Great app!");
  });
});
