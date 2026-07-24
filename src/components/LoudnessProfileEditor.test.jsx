/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoudnessProfileEditor } from "./LoudnessProfileEditor.jsx";

const threeRuleDocument = (overrides = {}) => ({
  id: "draft",
  name: "Draft",
  referenceLufs: null,
  rules: [
    { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
    { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
    { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
  ],
  ...overrides,
});

function editorProps(overrides = {}) {
  return {
    draft: { editingId: "profile-id", document: threeRuleDocument(), dirty: false },
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
    // Padded to the metric's decimals: the rule holds -1, the field reads -1.0.
    expect(screen.getByLabelText("Rule 3 value").value).toBe("-1.0");
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

  it("rounds a value to the precision its metric is displayed at", () => {
    const props = renderEditor();
    const input = screen.getByLabelText("Rule 1 value");
    fireEvent.change(input, { target: { value: "-23.456789" } });
    fireEvent.blur(input);
    expect(appliedDocument(props).rules[0].value).toBe(-23.5);
    expect(input.value).toBe("-23.5");
  });

  it("keeps two decimals on Correlation, which reads at two", () => {
    const props = renderEditor({
      draft: {
        editingId: "profile-id",
        document: threeRuleDocument({
          rules: [{ metricId: "correlation", op: "<", value: 0.5, severity: "warn" }],
        }),
        dirty: false,
      },
    });
    const input = screen.getByLabelText("Rule 1 value");
    fireEvent.change(input, { target: { value: "0.318" } });
    fireEvent.blur(input);
    expect(appliedDocument(props).rules[0].value).toBe(0.32);
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

  it("clears the threshold when a rule is repointed at another metric", () => {
    const props = renderEditor();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Rule 3 metric" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "Correlation" }));
    expect(appliedDocument(props).rules[2].value).toBeUndefined();
    expect(appliedDocument(props).rules[0].value).toBe(-22.5);
  });

  // Re-picking the metric a rule already has does not reach `onEdit` at all -- Radix suppresses
  // the change -- so the threshold survives by never being touched.
  it("does not edit at all when a rule is re-picked on the metric it already has", () => {
    const props = renderEditor();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Rule 1 metric" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "Integrated" }));
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it("keeps the threshold when only the operator changes", () => {
    const props = renderEditor();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Rule 3 operator" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "<" }));
    expect(appliedDocument(props).rules[2].value).toBe(-1);
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
        document: threeRuleDocument({ name: "Bare", rules: [] }),
        dirty: true,
      },
    });
    expect(screen.getByText("No rules — this profile does not judge any metrics.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(false);
  });

  it("shows a named profile statically and opens editing from the rename icon", () => {
    renderEditor({
      draft: { editingId: "x", document: threeRuleDocument({ name: "Mine" }), dirty: false },
    });
    // Named: the title is static until the pencil is clicked.
    expect(screen.queryByLabelText("Loudness Profile name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rename profile" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Loudness Profile name"));
  });

  it("resets name editing when the rendered draft changes from existing to new", () => {
    const props = editorProps({
      draft: {
        editingId: "existing",
        document: threeRuleDocument({ name: "Existing" }),
        dirty: false,
      },
    });
    const { rerender } = render(<LoudnessProfileEditor {...props} />);
    expect(screen.queryByLabelText("Loudness Profile name")).toBeNull();

    rerender(
      <LoudnessProfileEditor
        {...props}
        draft={{
          editingId: null,
          document: threeRuleDocument({ name: "Untitled", rules: [] }),
          dirty: false,
        }}
      />
    );

    const input = screen.getByLabelText("Loudness Profile name");
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Untitled");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Untitled".length);
  });

  it("opens a fresh draft with Untitled focused and selected", () => {
    renderEditor({
      draft: {
        editingId: null,
        document: threeRuleDocument({ name: "Untitled", rules: [] }),
        dirty: false,
      },
    });
    const input = screen.getByLabelText("Loudness Profile name");
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Untitled");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Untitled".length);
  });

  it("commits the name on blur and never rewrites the document id", () => {
    const props = renderEditor({
      draft: {
        editingId: null,
        document: threeRuleDocument({ name: "Untitled", rules: [] }),
        dirty: false,
      },
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
      draft: { editingId: "x", document: threeRuleDocument({ name: "Mine" }), dirty: false },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename profile" }));
    const input = screen.getByLabelText("Loudness Profile name");
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(props.onEdit).not.toHaveBeenCalled();
  });

  it("saves the default Untitled draft without requiring a rename", () => {
    const props = renderEditor({
      draft: {
        editingId: null,
        document: threeRuleDocument({ name: "Untitled", rules: [] }),
        dirty: false,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("commits a cleared name before saving", () => {
    const props = renderEditor({
      draft: {
        editingId: null,
        document: threeRuleDocument({ name: "Untitled", rules: [] }),
        dirty: false,
      },
    });
    const input = screen.getByLabelText("Loudness Profile name");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);

    const save = screen.getByRole("button", { name: "Save" });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    expect(appliedDocument(props).name).toBe("");
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onEdit.mock.invocationCallOrder[0]).toBeLessThan(
      props.onSave.mock.invocationCallOrder[0]
    );
  });

  it("cancels straight away when nothing was touched", () => {
    const props = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("asks before discarding touched edits", () => {
    const props = renderEditor({
      draft: { editingId: null, document: threeRuleDocument(), dirty: true },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a field the user is still typing in", () => {
    // Committing happens on blur, so a re-render arriving from elsewhere -- a rename, a preset
    // apply -- must not adopt the incoming value into a focused input.
    const draft = { editingId: "profile-id", document: threeRuleDocument(), dirty: false };
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
    const draft = { editingId: "profile-id", document: threeRuleDocument(), dirty: false };
    const props = { ...editorProps({ draft }) };
    const { rerender } = render(<LoudnessProfileEditor {...props} />);

    const moved = structuredClone(draft.document);
    moved.rules[0].value = -18;
    rerender(<LoudnessProfileEditor {...props} draft={{ ...draft, document: moved }} />);

    expect(screen.getByLabelText("Rule 1 value").value).toBe("-18.0");
  });

  it("pads a settled value out to the metric's decimals", () => {
    const props = renderEditor();
    const input = screen.getByLabelText("Rule 1 value");
    fireEvent.change(input, { target: { value: "14" } });
    fireEvent.blur(input);
    expect(appliedDocument(props).rules[0].value).toBe(14);
    expect(input.value).toBe("14.0");
  });

  it("pads Correlation out to two decimals", () => {
    renderEditor({
      draft: {
        editingId: "profile-id",
        document: threeRuleDocument({
          rules: [{ metricId: "correlation", op: "<", value: 0.5, severity: "warn" }],
        }),
        dirty: false,
      },
    });
    expect(screen.getByLabelText("Rule 1 value").value).toBe("0.50");
  });

  it("leaves Dialogue Coverage whole, which reads at no decimals", () => {
    const props = renderEditor({
      draft: {
        editingId: "profile-id",
        document: threeRuleDocument({
          rules: [{ metricId: "dialogueCoverage", op: "<", value: 60, severity: "warn" }],
        }),
        dirty: false,
      },
    });
    const input = screen.getByLabelText("Rule 1 value");
    expect(input.value).toBe("60");
    fireEvent.change(input, { target: { value: "61.7" } });
    fireEvent.blur(input);
    expect(appliedDocument(props).rules[0].value).toBe(62);
    expect(input.value).toBe("62");
  });

  it("keeps half-typed input untouched until it settles", () => {
    renderEditor();
    const input = screen.getByLabelText("Rule 1 value");
    input.focus();
    fireEvent.change(input, { target: { value: "-2" } });
    expect(input.value).toBe("-2");
  });
});
