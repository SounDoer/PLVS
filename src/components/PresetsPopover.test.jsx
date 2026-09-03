/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PresetsPopoverContent } from "./PresetsPopover.jsx";

const NOOP_PRESETS = {
  list: [],
  activeId: null,
  save: () => {},
  apply: () => {},
  update: () => {},
  rename: () => {},
  remove: () => {},
  reorder: () => {},
};

describe("PresetsPopoverContent", () => {
  it("shows empty-state hint and create row when list is empty", () => {
    render(<PresetsPopoverContent presets={NOOP_PRESETS} />);
    expect(screen.getByText("No presets yet. Save the current view to start.")).toBeTruthy();
    expect(screen.getByPlaceholderText("New preset name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("gives the new preset name input an accessible name", () => {
    render(<PresetsPopoverContent presets={NOOP_PRESETS} />);
    expect(screen.getByRole("textbox", { name: "New preset name" })).toBeTruthy();
  });

  it("fills the row without its content driving the panel width", () => {
    render(<PresetsPopoverContent presets={NOOP_PRESETS} />);
    const input = screen.getByRole("textbox", { name: "New preset name" });
    // `size={1}` + `flex-1` + `min-w-0`: fills the row and scrolls internally rather than letting a
    // long value inflate the `w-max` popover or push the Save button off-panel.
    expect(input.getAttribute("size")).toBe("1");
    expect(input.classList.contains("flex-1")).toBe(true);
    expect(input.classList.contains("min-w-0")).toBe(true);
    expect(input.classList.contains("[field-sizing:content]")).toBe(false);
  });

  it("disables Save when the name input is empty", () => {
    render(<PresetsPopoverContent presets={NOOP_PRESETS} />);
    expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(true);
  });

  it("calls save with the trimmed name and clears the input", () => {
    const save = vi.fn(() => true);
    render(<PresetsPopoverContent presets={{ ...NOOP_PRESETS, save }} />);
    const input = screen.getByPlaceholderText("New preset name");
    fireEvent.change(input, { target: { value: "  Focus  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith("Focus");
  });

  it("submits save on Enter when the name is non-empty", () => {
    const save = vi.fn(() => true);
    render(<PresetsPopoverContent presets={{ ...NOOP_PRESETS, save }} />);
    const input = screen.getByPlaceholderText("New preset name");
    fireEvent.change(input, { target: { value: "Mix" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(save).toHaveBeenCalledWith("Mix");
  });

  it("renders each preset name", () => {
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [
            { id: "a", name: "Focus" },
            { id: "b", name: "Mix" },
          ],
        }}
      />
    );
    expect(screen.getByText("Focus")).toBeTruthy();
    expect(screen.getByText("Mix")).toBeTruthy();
  });

  it("marks the active preset", () => {
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [
            { id: "a", name: "Focus" },
            { id: "b", name: "Mix" },
          ],
          activeId: "b",
        }}
      />
    );
    expect(screen.getByLabelText("Active preset Mix")).toBeTruthy();
    expect(screen.queryByLabelText("Active preset Focus")).toBeNull();
  });

  it("marks the active preset as modified when dirty", () => {
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [
            { id: "a", name: "Focus" },
            { id: "b", name: "Mix" },
          ],
          activeId: "b",
          dirty: true,
        }}
      />
    );
    expect(screen.getByLabelText("Active preset Mix (modified)")).toBeTruthy();
    expect(screen.getByText("Mix *")).toBeTruthy();
    expect(screen.getByText("Focus")).toBeTruthy();
  });

  it("applies a preset when the row is clicked", () => {
    const apply = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
          apply,
        }}
      />
    );
    fireEvent.click(screen.getByText("Focus"));
    expect(apply).toHaveBeenCalledWith("a");
  });

  it("uses a real button for applying a preset without nesting action buttons inside it", () => {
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
        }}
      />
    );

    const applyButton = screen.getByRole("button", { name: "Apply preset Focus" });
    const updateButton = screen.getByLabelText("Update preset Focus");
    expect(updateButton.closest("button")).not.toBe(applyButton);
  });

  it("updates a preset via the Update icon", () => {
    const update = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
          update,
        }}
      />
    );
    fireEvent.click(screen.getByLabelText("Update preset Focus"));
    expect(update).toHaveBeenCalledWith("a");
  });

  it("does not call apply when the Update icon is clicked (stopPropagation)", () => {
    const apply = vi.fn();
    const update = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
          apply,
          update,
        }}
      />
    );
    fireEvent.click(screen.getByLabelText("Update preset Focus"));
    expect(update).toHaveBeenCalledWith("a");
    expect(apply).not.toHaveBeenCalled();
  });

  it("enters rename mode, commits via Check, and calls rename", () => {
    const rename = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
          rename,
        }}
      />
    );
    fireEvent.click(screen.getByLabelText("Rename preset Focus"));
    const input = screen.getByLabelText("Rename preset Focus");
    fireEvent.change(input, { target: { value: "Focused" } });
    fireEvent.click(screen.getByLabelText("Save rename"));
    expect(rename).toHaveBeenCalledWith("a", "Focused");
  });

  it("commits rename on Enter", () => {
    const rename = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
          rename,
        }}
      />
    );
    fireEvent.click(screen.getByLabelText("Rename preset Focus"));
    const input = screen.getByLabelText("Rename preset Focus");
    fireEvent.change(input, { target: { value: "Focused" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(rename).toHaveBeenCalledWith("a", "Focused");
  });

  it("cancels rename via X without calling rename", () => {
    const rename = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
          rename,
        }}
      />
    );
    fireEvent.click(screen.getByLabelText("Rename preset Focus"));
    fireEvent.change(screen.getByLabelText("Rename preset Focus"), {
      target: { value: "Focused" },
    });
    fireEvent.click(screen.getByLabelText("Cancel rename"));
    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByText("Focus")).toBeTruthy();
  });

  it("cancels rename on Escape without calling rename", () => {
    const rename = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
          rename,
        }}
      />
    );
    fireEvent.click(screen.getByLabelText("Rename preset Focus"));
    const input = screen.getByLabelText("Rename preset Focus");
    fireEvent.change(input, { target: { value: "Focused" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByText("Focus")).toBeTruthy();
  });

  it("does not call apply when the Rename icon is clicked (stopPropagation)", () => {
    const apply = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
          apply,
        }}
      />
    );
    fireEvent.click(screen.getByLabelText("Rename preset Focus"));
    expect(apply).not.toHaveBeenCalled();
  });

  it("deletes a preset only after confirming", () => {
    const remove = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{ ...NOOP_PRESETS, list: [{ id: "a", name: "Focus" }], remove }}
      />
    );
    fireEvent.click(screen.getByLabelText("Delete preset Focus"));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Confirm delete preset Focus"));
    expect(remove).toHaveBeenCalledWith("a");
  });

  it("does not apply the preset while arming or confirming delete", () => {
    const apply = vi.fn();
    const remove = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{ ...NOOP_PRESETS, list: [{ id: "a", name: "Focus" }], apply, remove }}
      />
    );
    fireEvent.click(screen.getByLabelText("Delete preset Focus"));
    fireEvent.click(screen.getByLabelText("Confirm delete preset Focus"));
    expect(remove).toHaveBeenCalledWith("a");
    expect(apply).not.toHaveBeenCalled();
  });

  it("provides a dedicated drag handle for every preset", () => {
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [
            { id: "a", name: "Focus" },
            { id: "b", name: "Mix" },
          ],
        }}
      />
    );
    expect(screen.getByRole("button", { name: "Reorder Focus" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reorder Mix" })).toBeTruthy();
  });

  it("hides row-tail action icons until hover (opacity-0 group-hover class)", () => {
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
        }}
      />
    );
    const iconsSpan = screen.getByLabelText("Update preset Focus").closest("span.flex.shrink-0");
    expect(iconsSpan).toBeTruthy();
    expect(iconsSpan.className).toContain("opacity-0");
    expect(iconsSpan.className).toContain("group-hover:opacity-100");
  });

  it("shows row-tail action icons while keyboard focus is inside the preset row", () => {
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
        }}
      />
    );
    const iconsSpan = screen.getByLabelText("Update preset Focus").closest("span.flex.shrink-0");
    expect(iconsSpan).toBeTruthy();
    expect(iconsSpan.className).toContain("group-focus-within:opacity-100");
  });
});

/// Apply, Save and Update are refused by the controller while a draft-style editor is open. The
/// popover renders them disabled because a button that silently does nothing is worse than one
/// that looks disabled -- and the caption says how to clear the block.
describe("PresetsPopoverContent under an active blocking editor", () => {
  const PRESETS = {
    ...NOOP_PRESETS,
    list: [{ id: "p1", name: "Mixing" }],
    activeId: "p1",
    blocked: true,
  };

  it("disables scene operations and explains why", () => {
    render(<PresetsPopoverContent presets={PRESETS} />);

    expect(screen.getByRole("button", { name: "Apply preset Mixing" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Update preset Mixing" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Save" }).disabled).toBe(true);
    expect(screen.getByText("Finish or cancel the active editor first.")).toBeTruthy();
  });

  it("leaves the library actions alone", () => {
    render(<PresetsPopoverContent presets={PRESETS} />);

    expect(screen.getByRole("button", { name: "Rename preset Mixing" }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Delete preset Mixing" }).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Reorder Mixing" }).disabled).toBe(false);
  });

  it("does not apply on a click that lands before the disabled state renders", () => {
    const apply = vi.fn();
    render(<PresetsPopoverContent presets={{ ...PRESETS, apply }} />);

    fireEvent.click(screen.getByRole("button", { name: "Apply preset Mixing" }));

    expect(apply).not.toHaveBeenCalled();
  });

  it("does not save on Enter in the name field", () => {
    const save = vi.fn();
    render(<PresetsPopoverContent presets={{ ...PRESETS, save }} />);
    const input = screen.getByRole("textbox", { name: "New preset name" });

    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(save).not.toHaveBeenCalled();
  });

  it("shows no caption and no disabled buttons when nothing is open", () => {
    render(<PresetsPopoverContent presets={{ ...PRESETS, blocked: false }} />);

    expect(screen.getByRole("button", { name: "Apply preset Mixing" }).disabled).toBe(false);
    expect(screen.queryByText("Finish or cancel the active editor first.")).toBe(null);
  });
});
