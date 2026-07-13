import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockModulesEditor, reorderDockModulesAtPointer } from "./DockModulesEditor.jsx";

const BASE_PROPS = {
  modules: ["level", "spectrum"],
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onReorder: vi.fn(),
  onOpenSettings: vi.fn(),
  onDone: vi.fn(),
};

describe("DockModulesEditor", () => {
  it("lists only added modules in their current order", () => {
    render(<DockModulesEditor {...BASE_PROPS} />);
    const rows = screen.getAllByTestId(/dock-module-row-/);
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      "dock-module-row-level",
      "dock-module-row-spectrum",
    ]);
    expect(screen.queryByTestId("dock-module-row-loudness")).toBeNull();
  });

  it("removes a module with an explicit row action", () => {
    const onRemove = vi.fn();
    render(<DockModulesEditor {...BASE_PROPS} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Level" }));
    expect(onRemove).toHaveBeenCalledWith("level");
  });

  it("adds from the available modules list", () => {
    const onAdd = vi.fn();
    render(<DockModulesEditor {...BASE_PROPS} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Module" }));
    fireEvent.click(screen.getByRole("button", { name: "Loudness" }));
    expect(onAdd).toHaveBeenCalledWith("loudness");
    expect(screen.queryByRole("button", { name: "Level" })).toBeNull();
  });

  it("provides a dedicated drag handle for every added module", () => {
    render(<DockModulesEditor {...BASE_PROPS} />);
    expect(screen.getByRole("button", { name: "Reorder Level" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reorder Spectrum" })).toBeTruthy();
  });

  it("derives pointer-drag order from the row under the pointer", () => {
    expect(
      reorderDockModulesAtPointer(["level", "spectrum"], "level", 95, {
        top: 40,
        height: 72,
      })
    ).toEqual(["spectrum", "level"]);
  });

  it("opens settings only for modules with controls", () => {
    const onOpenSettings = vi.fn();
    render(
      <DockModulesEditor
        {...BASE_PROPS}
        modules={["level", "transport"]}
        onOpenSettings={onOpenSettings}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Level settings" }));
    expect(onOpenSettings).toHaveBeenCalledWith("level");
    expect(screen.queryByRole("button", { name: "Transport settings" })).toBeNull();
  });

  it("Done exits the editor", () => {
    const onDone = vi.fn();
    render(<DockModulesEditor {...BASE_PROPS} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledOnce();
  });
});
