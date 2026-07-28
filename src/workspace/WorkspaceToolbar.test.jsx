/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ModulesPopoverContent } from "./WorkspaceToolbar.jsx";
import { WorkspaceProvider } from "./WorkspaceContext.jsx";
import { DragProvider } from "./DragContext.jsx";
import { MetricsDataProvider } from "./AudioDataContext.jsx";
import { LeafView } from "./LeafView.jsx";
import { LoudnessProfileProvider } from "../hooks/LoudnessProfileContext.jsx";
import { workspaceStore } from "../persistence/index.js";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
  },
  Reorder: {
    Group: ({ children, role, "aria-label": ariaLabel, className }) => (
      <div role={role} aria-label={ariaLabel} className={className}>
        {children}
      </div>
    ),
    Item: ({ children, className }) => <div className={className}>{children}</div>,
  },
  useDragControls: () => ({ start: () => {} }),
}));

describe("ModulesPopoverContent", () => {
  beforeEach(() => {
    workspaceStore.reset();
  });

  it("keeps row actions hidden until the row is hovered", () => {
    render(
      <WorkspaceProvider>
        <ModulesPopoverContent />
      </WorkspaceProvider>
    );

    const renameButton = screen.getByLabelText("Rename Level Meter");
    const actions = renameButton.closest("span");

    expect(actions?.className).toContain("opacity-0");
    expect(actions?.className).toContain("group-hover:opacity-100");
    expect(actions?.className).toContain("group-focus-within:opacity-100");
  });

  it("shows the panel icon beside existing panel names", () => {
    render(
      <WorkspaceProvider>
        <ModulesPopoverContent />
      </WorkspaceProvider>
    );

    const row = screen.getByText("Level Meter").closest(".group");
    expect(row?.querySelector("svg")).toBeTruthy();
  });

  it("stretches module rows across the popover width", () => {
    render(
      <WorkspaceProvider>
        <ModulesPopoverContent />
      </WorkspaceProvider>
    );

    const row = screen.getByText("Level Meter").closest(".group");
    expect(row?.parentElement?.classList.contains("w-full")).toBe(true);
    expect(row?.parentElement?.classList.contains("w-max")).toBe(false);
  });

  it("arms then resets the layout via the Reset control", () => {
    render(
      <WorkspaceProvider>
        <ModulesPopoverContent />
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset layout" }));
    expect(screen.getByLabelText("Confirm reset layout")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Confirm reset layout"));
    // Default workspace has seven panels; the first is the Level Meter.
    expect(screen.getByText("Level Meter")).toBeTruthy();
  });

  it("arms delete on the panel trash before removing", () => {
    render(
      <WorkspaceProvider>
        <ModulesPopoverContent />
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByLabelText("Delete Level Meter"));
    expect(screen.getByLabelText("Confirm delete Level Meter")).toBeTruthy();
    expect(screen.getByText("Level Meter")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Confirm delete Level Meter"));
    expect(screen.queryByText("Level Meter")).toBeNull();
  });

  it("swaps to a full Add Module view instead of nesting a popover", () => {
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <ModulesPopoverContent />
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Module" }));

    expect(screen.getByText("Add Module")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back" })).toBeTruthy();
    expect(screen.queryByLabelText("Delete Level Meter")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Module" })).toBeNull();
  });

  it("stays on the Add Module view after a selection, then returns to the list via Back", () => {
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <ModulesPopoverContent />
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Module" }));
    fireEvent.click(screen.getByRole("button", { name: "Stereo Map" }));

    // A second add can follow immediately, without reopening the picker.
    expect(screen.getByText("Add Module")).toBeTruthy();
    expect(screen.queryByLabelText("Delete Level Meter")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByLabelText("Delete Level Meter")).toBeTruthy();
    expect(screen.getByLabelText("Delete Stereo Map")).toBeTruthy();
  });

  it("starts a create-drag from a module row's grip icon without triggering Add", () => {
    const onDrop = vi.fn();
    render(
      <WorkspaceProvider>
        <DragProvider onDrop={onDrop}>
          <ModulesPopoverContent />
        </DragProvider>
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Module" }));
    const grip = screen.getByRole("button", { name: "Drag Waveform to place" });

    fireEvent.mouseDown(grip, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 108, clientY: 100 });

    // The floating drag-ghost resolves the module's title from MODULE_REGISTRY, proving the
    // grip started a `{ kind: 'create', moduleId }` drag rather than reusing the tab-move path.
    // Two matches: the row's own label, plus the ghost tooltip that now renders alongside it.
    expect(screen.getAllByText("Waveform")).toHaveLength(2);
    expect(onDrop).not.toHaveBeenCalled();

    fireEvent.mouseUp(window, { clientX: 108, clientY: 100 });
  });

  it("highlights the corresponding panel frame while hovering a module row", () => {
    const { container } = render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <MetricsDataProvider value={{ statsMetrics: [] }}>
            <LoudnessProfileProvider>
              <ModulesPopoverContent />
              <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
            </LoudnessProfileProvider>
          </MetricsDataProvider>
        </DragProvider>
      </WorkspaceProvider>
    );

    const statsRow = screen
      .getAllByText("Stats")
      .find((el) => el.closest(".group"))
      ?.closest(".group");
    const leaf = container.querySelector("[data-leaf]");

    expect(leaf?.className).not.toContain("ring-primary/60");
    fireEvent.mouseEnter(statsRow);
    expect(leaf?.className).toContain("ring-primary/60");
    fireEvent.mouseLeave(statsRow);
    expect(leaf?.className).not.toContain("ring-primary/60");
  });
});
