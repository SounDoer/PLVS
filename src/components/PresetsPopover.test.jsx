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

  it("uses visible focus styles on rename action buttons", () => {
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
        }}
      />
    );
    fireEvent.click(screen.getByLabelText("Rename preset Focus"));

    expect(screen.getByLabelText("Save rename").className).toContain("focus-visible:ring-1");
    expect(screen.getByLabelText("Cancel rename").className).toContain("focus-visible:ring-1");
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

  it("deletes a preset via the Delete icon", () => {
    const remove = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
          remove,
        }}
      />
    );
    fireEvent.click(screen.getByLabelText("Delete preset Focus"));
    expect(remove).toHaveBeenCalledWith("a");
  });

  it("does not call apply when the Delete icon is clicked (stopPropagation)", () => {
    const apply = vi.fn();
    const remove = vi.fn();
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
          apply,
          remove,
        }}
      />
    );
    fireEvent.click(screen.getByLabelText("Delete preset Focus"));
    expect(remove).toHaveBeenCalledWith("a");
    expect(apply).not.toHaveBeenCalled();
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

  it("uses visible focus styles on row-tail action buttons", () => {
    render(
      <PresetsPopoverContent
        presets={{
          ...NOOP_PRESETS,
          list: [{ id: "a", name: "Focus" }],
        }}
      />
    );
    expect(screen.getByLabelText("Update preset Focus").className).toContain(
      "focus-visible:ring-1"
    );
    expect(screen.getByLabelText("Rename preset Focus").className).toContain(
      "focus-visible:ring-1"
    );
    expect(screen.getByLabelText("Delete preset Focus").className).toContain(
      "focus-visible:ring-1"
    );
  });
});
