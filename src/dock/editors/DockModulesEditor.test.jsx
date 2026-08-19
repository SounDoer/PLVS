/** @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockModulesEditor, reorderDockModulesAtPointer } from "./DockModulesEditor.jsx";

const BASE_PROPS = {
  modules: ["level", "spectrum"],
  onAdd: vi.fn(),
  onRemove: vi.fn(),
  onReorder: vi.fn(),
  onReset: vi.fn(),
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

  it("swaps to a full Add Module view instead of expanding the current list, and Back returns to it", () => {
    render(<DockModulesEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Module" }));

    expect(screen.getByText("Add Module")).toBeTruthy();
    expect(screen.queryByTestId("dock-panel-row-level")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Module" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByTestId("dock-panel-row-level")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Module" })).toBeTruthy();
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

  it("exposes Waveform settings", () => {
    const onOpenSettings = vi.fn();
    render(
      <DockModulesEditor {...BASE_PROPS} modules={["waveform"]} onOpenSettings={onOpenSettings} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Waveform settings" }));
    expect(onOpenSettings).toHaveBeenCalledWith("waveform");
  });

  it("hides Vectorscope settings when there is no alternative channel pair", () => {
    const { rerender } = render(
      <DockModulesEditor
        {...BASE_PROPS}
        modules={["correlation"]}
        vectorscopeSettingsAvailable={false}
      />
    );
    expect(screen.queryByRole("button", { name: "Vectorscope settings" })).toBeNull();

    rerender(
      <DockModulesEditor {...BASE_PROPS} modules={["correlation"]} vectorscopeSettingsAvailable />
    );
    expect(screen.getByRole("button", { name: "Vectorscope settings" })).toBeTruthy();
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

  it("uses the shared management row density and reveal behavior", () => {
    render(<DockModulesEditor {...BASE_PROPS} />);
    const row = screen.getByTestId("dock-panel-row-spectrum");
    const actions = screen.getByRole("button", { name: "Rename Spectrum" }).closest("span");

    expect(row.className).toContain("py-1.5");
    expect(row.className).toContain("focus-within:bg-muted/50");
    expect(actions?.className).toContain("group-hover:opacity-100");
    expect(actions?.className).toContain("group-focus-within:opacity-100");
  });

  it("does not render a title close button", () => {
    render(<DockModulesEditor {...BASE_PROPS} />);
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("arms then resets the layout via the Reset control", () => {
    const onReset = vi.fn();
    render(<DockModulesEditor {...BASE_PROPS} onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
    expect(screen.getByLabelText("Confirm reset layout")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Confirm reset layout"));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
