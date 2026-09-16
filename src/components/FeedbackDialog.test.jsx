/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeedbackDialog } from "./FeedbackDialog.jsx";

const { readFeedbackDiagnostics } = vi.hoisted(() => ({ readFeedbackDiagnostics: vi.fn() }));

vi.mock("@/lib/feedback.js", () => ({
  submitFeedback: vi.fn(),
}));
vi.mock("../ipc/commands.js", () => ({ readFeedbackDiagnostics }));

import { submitFeedback } from "@/lib/feedback.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("FeedbackDialog", () => {
  it("disables submit until content is entered", () => {
    render(<FeedbackDialog onClose={vi.fn()} />);
    expect(screen.getByLabelText("attach diagnostics").checked).toBe(false);
    expect(screen.getByText(/version, system details, and the last 200 log lines/i)).toBeTruthy();
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
    expect(readFeedbackDiagnostics).not.toHaveBeenCalled();
    expect(await screen.findByText("Thanks! Feedback sent.")).toBeTruthy();

    vi.advanceTimersByTime(2000);
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("reads and attaches diagnostics only after the user opts in", async () => {
    const diagnostics = {
      schemaVersion: 1,
      app: { version: "0.15.4", os: "windows", arch: "x86_64" },
      logs: ["last line"],
    };
    let resolveDiagnostics;
    readFeedbackDiagnostics.mockReturnValue(
      new Promise((resolve) => {
        resolveDiagnostics = resolve;
      })
    );
    submitFeedback.mockResolvedValue(false);
    render(<FeedbackDialog onClose={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Feedback content"), {
      target: { value: "Great app!" },
    });
    fireEvent.click(screen.getByLabelText("attach diagnostics"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByRole("button", { name: "Preparing..." }).disabled).toBe(true);
    resolveDiagnostics(diagnostics);
    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith({
        content: "Great app!",
        email: undefined,
        diagnostics,
      })
    );
  });

  it("does not send a falsely checked request when diagnostics fail and allows retry", async () => {
    readFeedbackDiagnostics
      .mockRejectedValueOnce(new Error("diagnostics unavailable"))
      .mockResolvedValueOnce({
        schemaVersion: 1,
        app: { version: "0.15.4", os: "windows", arch: "x86_64" },
        logs: [],
      });
    submitFeedback.mockResolvedValue(false);
    render(<FeedbackDialog onClose={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Feedback content"), {
      target: { value: "Great app!" },
    });
    fireEvent.click(screen.getByLabelText("attach diagnostics"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(
      await screen.findByText("Could not prepare diagnostics. Nothing was sent.")
    ).toBeTruthy();
    expect(submitFeedback).not.toHaveBeenCalled();
    expect(screen.getByLabelText("attach diagnostics").checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(readFeedbackDiagnostics).toHaveBeenCalledTimes(2));
    expect(submitFeedback).toHaveBeenCalledTimes(1);
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
