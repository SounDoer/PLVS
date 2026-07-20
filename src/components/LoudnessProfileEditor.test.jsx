/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoudnessProfileEditor } from "./LoudnessProfileEditor.jsx";
import { createDefaultCustomDraft } from "@/lib/loudnessProfileCatalog.js";

function editorProps(overrides = {}) {
  return {
    draft: { editingId: null, document: createDefaultCustomDraft(), dirty: false },
    onEdit: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    pos: { x: 10, y: 10 },
    onMove: vi.fn(),
    ...overrides,
  };
}

function renderEditor(overrides = {}) {
  const props = editorProps(overrides);
  render(<LoudnessProfileEditor {...props} />);
  return props;
}

/// Runs the mutator the panel handed to `onEdit` against the draft it was rendered with, so a
/// test can assert on the document the provider would end up storing rather than on the closure.
function appliedDocument(props, call = 0) {
  const mutator = props.onEdit.mock.calls[call][0];
  return mutator(props.draft.document);
}

describe("LoudnessProfileEditor", () => {
  it("lists a row per rule, in the profile's own order", () => {
    renderEditor();
    expect(screen.getByText("Integrated")).toBeTruthy();
    expect(screen.getByText("True Peak Max")).toBeTruthy();
  });

  it("renders a target rule as target and band", () => {
    renderEditor();
    expect(screen.getByLabelText("Integrated target").value).toBe("-23");
    expect(screen.getByLabelText("Integrated tolerance minus").value).toBe("0.5");
    expect(screen.getByLabelText("Integrated tolerance plus").value).toBe("0.5");
  });

  it("renders a limit rule as two bounds, either blank", () => {
    renderEditor();
    expect(screen.getByLabelText("True Peak Max maximum").value).toBe("-1");
    expect(screen.getByLabelText("True Peak Max minimum").value).toBe("");
  });

  it("commits a number on blur, not per keystroke", () => {
    const props = renderEditor();
    const input = screen.getByLabelText("Integrated target");
    fireEvent.change(input, { target: { value: "-2" } });
    expect(props.onEdit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(appliedDocument(props).metrics.integrated.target).toBe(-2);
  });

  it("commits a number on Enter", () => {
    const props = renderEditor();
    const input = screen.getByLabelText("True Peak Max maximum");
    // Enter commits by blurring, and jsdom only fires blur on a focused element.
    input.focus();
    fireEvent.change(input, { target: { value: "-2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(appliedDocument(props).metrics.truePeak.max).toBe(-2);
  });

  it("leaves a cleared band unset rather than zero", () => {
    const props = renderEditor();
    const input = screen.getByLabelText("Integrated tolerance minus");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    const tolerance = appliedDocument(props).metrics.integrated.tolerance;
    expect(tolerance.minus).toBeUndefined();
    expect(tolerance.plus).toBe(0.5);
  });

  it("moves the anchor target with the reference", () => {
    const props = renderEditor();
    const input = screen.getByLabelText("Loudness Profile reference");
    fireEvent.change(input, { target: { value: "-16" } });
    fireEvent.blur(input);
    const next = appliedDocument(props);
    expect(next.referenceLufs).toBe(-16);
    expect(next.metrics.integrated.target).toBe(-16);
  });

  it("offers only metrics not already in the profile", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add metric" }));
    expect(screen.getByRole("button", { name: "Add Correlation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Integrated" })).toBeNull();
  });

  it("adds a metric as an empty rule in the metric's own shape", () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add metric" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Correlation" }));
    const next = appliedDocument(props);
    expect(next.metrics.correlation).toEqual({ role: "limit", severity: "fail" });
    expect(next.preferredMetricIds).toContain("correlation");
  });

  it("removes a rule", () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Remove True Peak Max" }));
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    const next = appliedDocument(props);
    expect(next.metrics.truePeak).toBeUndefined();
    expect(next.preferredMetricIds).not.toContain("truePeak");
  });

  it("exposes severity per rule", () => {
    renderEditor();
    expect(screen.getByLabelText("Integrated severity").value).toBe("fail");
  });

  it("changes severity per rule", () => {
    const props = renderEditor();
    fireEvent.change(screen.getByLabelText("Integrated severity"), { target: { value: "warn" } });
    expect(appliedDocument(props).metrics.integrated.severity).toBe("warn");
  });

  it("never rewrites the document id", () => {
    const props = renderEditor();
    fireEvent.change(screen.getByLabelText("Loudness Profile name"), {
      target: { value: "Mine" },
    });
    const next = appliedDocument(props);
    expect(next.name).toBe("Mine");
    expect(next.id).toBe(props.draft.document.id);
  });

  it("refuses to save an unnamed profile", () => {
    renderEditor({
      draft: {
        editingId: null,
        document: { ...createDefaultCustomDraft(), name: "  " },
        dirty: true,
      },
    });
    expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(true);
  });

  it("cancels straight away when nothing was touched", () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding touched edits", () => {
    const props = renderEditor({
      draft: { editingId: null, document: createDefaultCustomDraft(), dirty: true },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a field the user is still typing in", () => {
    // Committing happens on blur, so a re-render arriving from elsewhere -- a rename, a preset
    // apply -- must not adopt the incoming value into a focused input.
    const draft = { editingId: null, document: createDefaultCustomDraft(), dirty: false };
    const props = { ...editorProps({ draft }) };
    const { rerender } = render(<LoudnessProfileEditor {...props} />);

    const input = screen.getByLabelText("Integrated tolerance plus");
    input.focus();
    fireEvent.change(input, { target: { value: "1.2" } });

    const moved = structuredClone(draft.document);
    moved.metrics.integrated.tolerance.plus = 2;
    rerender(<LoudnessProfileEditor {...props} draft={{ ...draft, document: moved }} />);

    expect(input.value).toBe("1.2");
  });

  it("adopts an incoming value when the field is not focused", () => {
    const draft = { editingId: null, document: createDefaultCustomDraft(), dirty: false };
    const props = { ...editorProps({ draft }) };
    const { rerender } = render(<LoudnessProfileEditor {...props} />);

    const moved = structuredClone(draft.document);
    moved.metrics.integrated.tolerance.plus = 2;
    rerender(<LoudnessProfileEditor {...props} draft={{ ...draft, document: moved }} />);

    expect(screen.getByLabelText("Integrated tolerance plus").value).toBe("2");
  });

  it("carries the honesty note", () => {
    renderEditor();
    expect(screen.getByText(/not a certification/i)).toBeTruthy();
  });
});
