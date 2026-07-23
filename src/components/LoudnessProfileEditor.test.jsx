/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoudnessProfileEditor } from "./LoudnessProfileEditor.jsx";
import { createProfileDraft } from "@/lib/loudnessProfileCatalog.js";

// A named draft by default, so the editor opens with a static title and the rule rows in focus.
// The name-editing tests pass an unnamed draft (which opens straight into the name field).
const namedDraft = () => ({ ...createProfileDraft(), name: "Draft" });
const unnamedDraft = () => ({ ...createProfileDraft(), name: "" });

function editorProps(overrides = {}) {
  return {
    draft: { editingId: null, document: namedDraft(), dirty: false },
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
  // createProfileDraft() opens on: integrated >-22.5 fail, integrated <-23.5 fail, truePeak >-1 fail.

  it("lists a row per rule, in the profile's own order", () => {
    renderEditor();
    expect(screen.getByRole("combobox", { name: "Rule 1 metric" }).textContent).toContain(
      "Integrated"
    );
    expect(screen.getByRole("combobox", { name: "Rule 2 metric" }).textContent).toContain(
      "Integrated"
    );
    expect(screen.getByRole("combobox", { name: "Rule 3 metric" }).textContent).toContain(
      "True Peak Max"
    );
  });

  it("renders each rule as metric, operator and value", () => {
    renderEditor();
    expect(screen.getByRole("combobox", { name: "Rule 1 operator" }).textContent).toBe(">");
    expect(screen.getByLabelText("Rule 1 value").value).toBe("-22.5");
    expect(screen.getByRole("combobox", { name: "Rule 2 operator" }).textContent).toBe("<");
    expect(screen.getByLabelText("Rule 2 value").value).toBe("-23.5");
    expect(screen.getByLabelText("Rule 3 value").value).toBe("-1");
  });

  it("commits a value on blur, not per keystroke", () => {
    const props = renderEditor();
    const input = screen.getByLabelText("Rule 3 value");
    fireEvent.change(input, { target: { value: "-2" } });
    expect(props.onEdit).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(appliedDocument(props).rules[2].value).toBe(-2);
  });

  it("commits a value on Enter", () => {
    const props = renderEditor();
    const input = screen.getByLabelText("Rule 3 value");
    // Enter commits by blurring, and jsdom only fires blur on a focused element.
    input.focus();
    fireEvent.change(input, { target: { value: "-2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    expect(appliedDocument(props).rules[2].value).toBe(-2);
  });

  it("leaves a cleared value unset rather than zero", () => {
    const props = renderEditor();
    const input = screen.getByLabelText("Rule 1 value");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(appliedDocument(props).rules[0].value).toBeUndefined();
  });

  it("sets the reference without touching the rules", () => {
    const props = renderEditor();
    const input = screen.getByLabelText("Loudness Profile reference");
    fireEvent.change(input, { target: { value: "-16" } });
    fireEvent.blur(input);
    const next = appliedDocument(props);
    expect(next.referenceLufs).toBe(-16);
    expect(next.rules).toEqual(props.draft.document.rules);
  });

  it("changes a rule's metric from its own select", () => {
    const props = renderEditor();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Rule 3 metric" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "Correlation" }));
    expect(appliedDocument(props).rules[2].metricId).toBe("correlation");
  });

  it("changes a rule's operator", () => {
    const props = renderEditor();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Rule 3 operator" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "<" }));
    expect(appliedDocument(props).rules[2].op).toBe("<");
  });

  it("adds a blank rule on Integrated", () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    const next = appliedDocument(props);
    expect(next.rules).toHaveLength(4);
    expect(next.rules[3]).toEqual({
      metricId: "integrated",
      op: ">",
      value: undefined,
      severity: "fail",
    });
  });

  it("removes a rule", () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 3" }));
    expect(props.onEdit).toHaveBeenCalledTimes(1);
    const next = appliedDocument(props);
    expect(next.rules).toHaveLength(2);
    expect(next.rules.some((r) => r.metricId === "truePeak")).toBe(false);
  });

  it("exposes severity per rule", () => {
    renderEditor();
    expect(screen.getByRole("combobox", { name: "Rule 1 severity" }).textContent).toBe("Fail");
  });

  it("changes severity per rule", () => {
    const props = renderEditor();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Rule 1 severity" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "Warn" }));
    expect(appliedDocument(props).rules[0].severity).toBe("warn");
  });

  it("shows an empty-state and still allows saving a rule-less profile", () => {
    renderEditor({
      draft: {
        editingId: null,
        document: { ...createProfileDraft(), name: "Bare", rules: [] },
        dirty: true,
      },
    });
    expect(screen.getByText(/only draws its reference line/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(false);
  });

  it("shows a named profile statically and opens editing from the rename icon", () => {
    renderEditor({
      draft: { editingId: "x", document: { ...createProfileDraft(), name: "Mine" }, dirty: false },
    });
    // Named: the title is static until the pencil is clicked.
    expect(screen.queryByLabelText("Loudness Profile name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rename profile" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Loudness Profile name"));
  });

  it("opens a fresh unnamed draft straight into the name field", () => {
    renderEditor({ draft: { editingId: null, document: unnamedDraft(), dirty: false } });
    expect(screen.getByLabelText("Loudness Profile name")).toBeTruthy();
  });

  it("commits the name on blur and never rewrites the document id", () => {
    const props = renderEditor({
      draft: { editingId: null, document: unnamedDraft(), dirty: false },
    });
    const input = screen.getByLabelText("Loudness Profile name");
    fireEvent.change(input, { target: { value: "Mine" } });
    fireEvent.blur(input);
    const next = appliedDocument(props);
    expect(next.name).toBe("Mine");
    expect(next.id).toBe(props.draft.document.id);
  });

  it("discards a name edit on Escape", () => {
    const props = renderEditor({
      draft: { editingId: "x", document: { ...createProfileDraft(), name: "Mine" }, dirty: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename profile" }));
    const input = screen.getByLabelText("Loudness Profile name");
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it("refuses to save an unnamed profile", () => {
    renderEditor({
      draft: {
        editingId: null,
        document: { ...createProfileDraft(), name: "  " },
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
      draft: { editingId: null, document: createProfileDraft(), dirty: true },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a field the user is still typing in", () => {
    // Committing happens on blur, so a re-render arriving from elsewhere -- a rename, a preset
    // apply -- must not adopt the incoming value into a focused input.
    const draft = { editingId: null, document: createProfileDraft(), dirty: false };
    const props = { ...editorProps({ draft }) };
    const { rerender } = render(<LoudnessProfileEditor {...props} />);

    const input = screen.getByLabelText("Rule 1 value");
    input.focus();
    fireEvent.change(input, { target: { value: "-30" } });

    const moved = structuredClone(draft.document);
    moved.rules[0].value = -18;
    rerender(<LoudnessProfileEditor {...props} draft={{ ...draft, document: moved }} />);

    expect(input.value).toBe("-30");
  });

  it("adopts an incoming value when the field is not focused", () => {
    const draft = { editingId: null, document: createProfileDraft(), dirty: false };
    const props = { ...editorProps({ draft }) };
    const { rerender } = render(<LoudnessProfileEditor {...props} />);

    const moved = structuredClone(draft.document);
    moved.rules[0].value = -18;
    rerender(<LoudnessProfileEditor {...props} draft={{ ...draft, document: moved }} />);

    expect(screen.getByLabelText("Rule 1 value").value).toBe("-18");
  });
});
