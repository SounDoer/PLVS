import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockModulesEditor, reorderDockModulesAtPointer } from "./DockModulesEditor.jsx";

const BASE_PROPS = {
  modules: ["level", "spectrum"],
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onReorder: vi.fn(),
  onOpenSettings: vi.fn(),
};

describe("DockModulesEditor", () => {
  it("lists only added modules in their current order", () => {
    render(<DockModulesEditor {...BASE_PROPS} />);
    const rows = screen.getAllByTestId(/dock-panel-row-/);
    expect(rows.map((row) => row.dataset.testid)).toEqual([
      "dock-panel-row-level",
      "dock-panel-row-spectrum",
    ]);
    expect(screen.queryByTestId("dock-panel-row-loudness")).toBeNull();
  });

  it("removes a module with an explicit row action", () => {
    const onRemove = vi.fn();
    render(<DockModulesEditor {...BASE_PROPS} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Level Meter" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete Level Meter" }));
    expect(onRemove).toHaveBeenCalledWith("level");
  });

  it("adds from the available modules list", () => {
    const onAdd = vi.fn();
    render(<DockModulesEditor {...BASE_PROPS} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Module" }));
    fireEvent.click(screen.getByRole("button", { name: "Loudness" }));
    expect(onAdd).toHaveBeenCalledWith("loudness");
    expect(screen.getByRole("button", { name: "Level Meter" })).toBeTruthy();
  });

  it("offers the dock-only Timecode module in the add list", () => {
    const onAdd = vi.fn();
    render(<DockModulesEditor {...BASE_PROPS} onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Module" }));
    fireEvent.click(screen.getByRole("button", { name: "Timecode" }));
    expect(onAdd).toHaveBeenCalledWith("transport");
  });

  it("provides a dedicated drag handle for every added module", () => {
    render(<DockModulesEditor {...BASE_PROPS} />);
    expect(screen.getByRole("button", { name: "Reorder Level Meter" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reorder Spectrum" })).toBeTruthy();
  });

  it("reports the panel row currently hovered", () => {
    const onHover = vi.fn();
    render(<DockModulesEditor {...BASE_PROPS} onHover={onHover} />);
    const row = screen.getByTestId("dock-panel-row-spectrum");
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    expect(onHover).toHaveBeenNthCalledWith(1, "spectrum");
    expect(onHover).toHaveBeenNthCalledWith(2, null);
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
    fireEvent.click(screen.getByRole("button", { name: "Level Meter settings" }));
    expect(onOpenSettings).toHaveBeenCalledWith("level");
    expect(screen.getByText("Timecode")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Timecode settings" })).toBeNull();
  });

  it("orders row actions as settings, rename, and delete", () => {
    render(<DockModulesEditor {...BASE_PROPS} />);
    const row = screen.getByTestId("dock-panel-row-spectrum");
    expect(
      within(row)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"))
    ).toEqual(["Reorder Spectrum", "Spectrum settings", "Rename Spectrum", "Delete Spectrum"]);
  });

  it("does not render a title close button", () => {
    render(<DockModulesEditor {...BASE_PROPS} />);
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });
});
