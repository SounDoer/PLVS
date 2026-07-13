import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockModulesEditor } from "./DockModulesEditor.jsx";

describe("DockModulesEditor", () => {
  it("renders a chip per registry module, marking enabled ones", () => {
    render(
      <DockModulesEditor
        modules={["level", "spectrum"]}
        onToggle={vi.fn()}
        onReorder={vi.fn()}
        onDone={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /^level/i }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByRole("button", { name: /^loudness/i }).getAttribute("aria-pressed")).toBe(
      "false"
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
    fireEvent.click(screen.getByRole("button", { name: /^loudness/i }));
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
    const level = screen.getByRole("button", { name: /^level/i });
    const loudness = screen.getByRole("button", { name: /^loudness/i });
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
});

describe("stats picker row", () => {
  it("is hidden while the stats module is disabled", () => {
    render(
      <DockModulesEditor
        modules={["level"]}
        statsIds={["lra"]}
        onToggle={vi.fn()}
        onToggleStat={vi.fn()}
        onReorder={vi.fn()}
        onDone={vi.fn()}
      />
    );
    expect(screen.queryByTestId("dock-stats-picker")).toBeNull();
  });

  it("lists all catalog stats as chips and toggles them", () => {
    const onToggleStat = vi.fn();
    render(
      <DockModulesEditor
        modules={["stats"]}
        statsIds={["lra"]}
        onToggle={vi.fn()}
        onToggleStat={onToggleStat}
        onReorder={vi.fn()}
        onDone={vi.fn()}
      />
    );
    const picker = screen.getByTestId("dock-stats-picker");
    expect(picker).toBeTruthy();
    const lraChip = screen.getByRole("button", { name: /^LRA$/i });
    expect(lraChip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^PSR$/i }));
    expect(onToggleStat).toHaveBeenCalledWith("psr");
  });
});
