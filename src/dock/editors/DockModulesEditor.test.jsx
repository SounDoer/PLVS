import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockModulesEditor } from "./DockModulesEditor.jsx";

describe("DockModulesEditor", () => {
  it("renders a vertical row per registry module, marking enabled ones", () => {
    render(
      <DockModulesEditor
        modules={["level", "spectrum"]}
        onToggle={vi.fn()}
        onReorder={vi.fn()}
        onDone={vi.fn()}
      />
    );
    expect(screen.getByRole("switch", { name: "Level module" }).getAttribute("data-state")).toBe(
      "checked"
    );
    expect(screen.getByRole("switch", { name: "Loudness module" }).getAttribute("data-state")).toBe(
      "unchecked"
    );
  });

  it("clicking a chip toggles the module", () => {
    const onToggle = vi.fn();
    render(
      <DockModulesEditor
        modules={["level"]}
        onToggle={onToggle}
        onReorder={vi.fn()}
        onDone={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("switch", { name: "Loudness module" }));
    expect(onToggle).toHaveBeenCalledWith("loudness");
  });

  it("drag-and-drop reorders enabled chips", () => {
    const onReorder = vi.fn();
    render(
      <DockModulesEditor
        modules={["level", "loudness"]}
        onToggle={vi.fn()}
        onReorder={onReorder}
        onDone={vi.fn()}
      />
    );
    const level = screen.getByTestId("dock-module-row-level");
    const loudness = screen.getByTestId("dock-module-row-loudness");
    fireEvent.dragStart(level, { dataTransfer: { setData: vi.fn() } });
    fireEvent.drop(loudness, { dataTransfer: { getData: () => "" } });
    expect(onReorder).toHaveBeenCalledWith(0, 1);
  });

  it("Done exits the editor", () => {
    const onDone = vi.fn();
    render(
      <DockModulesEditor modules={[]} onToggle={vi.fn()} onReorder={vi.fn()} onDone={onDone} />
    );
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onDone).toHaveBeenCalled();
  });
  it("opens settings for modules with controls", () => {
    const onOpenSettings = vi.fn();
    render(
      <DockModulesEditor
        modules={["level"]}
        onToggle={vi.fn()}
        onReorder={vi.fn()}
        onOpenSettings={onOpenSettings}
        onDone={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Level settings" }));
    expect(onOpenSettings).toHaveBeenCalledWith("level");
    expect(screen.queryByRole("button", { name: "Transport settings" })).toBeNull();
  });
});
