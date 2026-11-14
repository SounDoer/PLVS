/** @vitest-environment jsdom */
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFeedbackDraft } from "./useFeedbackDraft.js";
import { FeedbackContent } from "../components/FeedbackDialog.jsx";
import { BlockingEditorsProvider, useBlockingEditors } from "./BlockingEditorsContext.jsx";

const { readFeedbackDiagnostics, submitFeedback } = vi.hoisted(() => ({
  readFeedbackDiagnostics: vi.fn(),
  submitFeedback: vi.fn(),
}));
vi.mock("../ipc/commands.js", () => ({ readFeedbackDiagnostics }));
vi.mock("../lib/feedback.js", () => ({ submitFeedback }));

afterEach(() => {
  vi.clearAllMocks();
});

describe("Feedback owner lifetime", () => {
  it("preserves the draft and scene guard while its presentation is absent", () => {
    /** @type {ReturnType<typeof useFeedbackDraft>} */
    let controller;
    let guards;
    function Host({ visible }) {
      controller = useFeedbackDraft({ onClose: vi.fn() });
      guards = useBlockingEditors();
      return visible ? <FeedbackContent controller={controller} onClose={vi.fn()} /> : null;
    }
    const view = render(
      <BlockingEditorsProvider>
        <Host visible />
      </BlockingEditorsProvider>
    );
    fireEvent.input(screen.getByLabelText("Feedback content"), {
      target: { value: "Keep this draft" },
    });
    view.rerender(
      <BlockingEditorsProvider>
        <Host visible={false} />
      </BlockingEditorsProvider>
    );
    expect(controller.content).toBe("Keep this draft");
    expect(() => guards.assertSceneOperationAllowed("preset.apply")).toThrow();
    view.rerender(
      <BlockingEditorsProvider>
        <Host visible />
      </BlockingEditorsProvider>
    );
    expect(
      /** @type {HTMLTextAreaElement} */ (screen.getByLabelText("Feedback content")).value
    ).toBe("Keep this draft");
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it("does not send or populate a later session after diagnostics finishes for a canceled one", async () => {
    let resolve;
    readFeedbackDiagnostics.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const { result, rerender } = renderHook(
      ({ active }) => useFeedbackDraft({ active, onClose: vi.fn() }),
      { initialProps: { active: true } }
    );
    act(() => {
      result.current.setContent("Old draft");
      result.current.setAttachDiagnostics(true);
    });
    let pending;
    act(() => {
      pending = result.current.handleSubmit();
    });
    rerender({ active: false });
    rerender({ active: true });
    act(() => {
      result.current.setContent("New draft");
    });
    await act(async () => {
      resolve({ logs: "Old diagnostics" });
      await pending;
    });
    expect(submitFeedback).not.toHaveBeenCalled();
    expect(result.current.content).toBe("New draft");
    expect(result.current.diagnosticsPreview).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("previews the submission payload without sending or changing the draft", async () => {
    readFeedbackDiagnostics.mockResolvedValue({ logs: "local diagnostics" });
    const { result } = renderHook(() => useFeedbackDraft({ onClose: vi.fn() }));
    act(() =>
      result.current.commitDraftDocument({
        content: "  A report  ",
        email: "  feedback@example.invalid  ",
        attachDiagnostics: true,
      })
    );
    const before = result.current.inspectDraft();
    expect(await result.current.previewSubmission()).toEqual({
      content: "A report",
      email: "feedback@example.invalid",
      diagnostics: { logs: "local diagnostics" },
    });
    expect(result.current.inspectDraft()).toEqual(before);
    expect(result.current.diagnosticsPreview).toBeNull();
    expect(submitFeedback).not.toHaveBeenCalled();
  });

  it("deduplicates submission before React has rendered the busy state", async () => {
    let resolve;
    submitFeedback.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const { result } = renderHook(() => useFeedbackDraft({ onClose: vi.fn() }));
    act(() => {
      result.current.setContent("A report");
    });
    let first;
    act(() => {
      first = result.current.handleSubmit();
      void result.current.handleSubmit();
    });
    expect(submitFeedback).toHaveBeenCalledOnce();
    await act(async () => {
      resolve(false);
      await first;
    });
    expect(result.current.status).toBe("error");
  });
});
