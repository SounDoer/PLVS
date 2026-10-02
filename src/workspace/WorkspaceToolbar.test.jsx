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
    // Stereo Map is already in the first-run workspace, so adding another gives the second
    // unnamed instance its disambiguating "2" suffix.
    expect(screen.getByLabelText("Delete Stereo Map 2")).toBeTruthy();
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

    // The invalid-target hint resolves the module's title from MODULE_REGISTRY, proving the grip
    // started a `{ kind: 'create', moduleId }` drag rather than reusing the tab-move path.
    expect(screen.getByText("Waveform · No Drop Target")).toBeTruthy();
    expect(onDrop).not.toHaveBeenCalled();

    fireEvent.mouseUp(window, { clientX: 108, clientY: 100 });
  });

  it("cancels a create-drag when the window loses focus", () => {
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
    expect(screen.getByText("Waveform · No Drop Target")).toBeTruthy();

    fireEvent(window, new Event("blur"));
    expect(screen.queryByText("Waveform · No Drop Target")).toBeNull();

    fireEvent.mouseMove(window, { clientX: 120, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: 120, clientY: 100 });
    expect(screen.queryByText("Waveform · No Drop Target")).toBeNull();
    expect(onDrop).not.toHaveBeenCalled();
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

    expect(leaf?.className).not.toContain("ring-primary");
    fireEvent.mouseEnter(statsRow);
    expect(leaf?.className).toContain("ring-primary");
    fireEvent.mouseLeave(statsRow);
    expect(leaf?.className).not.toContain("ring-primary");
  });
});

describe("panel placement preview", () => {
  beforeEach(() => {
    workspaceStore.reset();
  });

  function renderStatsLeaf(onDrop = vi.fn()) {
    const view = render(
      <WorkspaceProvider>
        <DragProvider onDrop={onDrop}>
          <MetricsDataProvider value={{ statsMetrics: [] }}>
            <LoudnessProfileProvider>
              <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
            </LoudnessProfileProvider>
          </MetricsDataProvider>
        </DragProvider>
      </WorkspaceProvider>
    );
    const leaf = view.container.querySelector("[data-leaf]");
    const body = view.container.querySelector("[data-leaf-body]");
    const tabs = view.container.querySelector("[data-leaf-tabs]");
    leaf.getBoundingClientRect = () => ({
      left: 0,
      right: 200,
      top: 0,
      bottom: 130,
      width: 200,
      height: 130,
    });
    body.getBoundingClientRect = () => ({
      left: 0,
      right: 200,
      top: 30,
      bottom: 130,
      width: 200,
      height: 100,
    });
    tabs.getBoundingClientRect = () => ({
      left: 0,
      right: 200,
      top: 0,
      bottom: 30,
      width: 200,
      height: 30,
    });
    return { ...view, leaf, body, tabs, onDrop };
  }

  it("shows a translucent directional footprint on the first active drag movement", () => {
    const view = renderStatsLeaf();
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [view.body, view.leaf]),
    });

    fireEvent.mouseDown(view.container.querySelector("[data-panel-title-group]"), {
      clientX: 100,
      clientY: 15,
    });
    fireEvent.mouseMove(window, { clientX: 190, clientY: 80 });

    const preview = view.container.querySelector("[data-drop-preview]");
    const hint = preview?.querySelector("[data-drop-hint]");
    expect(preview?.dataset.dropZone).toBe("right");
    expect(preview?.className).toContain("w-1/2");
    expect(preview?.className).not.toContain("border");
    expect(preview?.style.backgroundColor).toContain("transparent");
    expect(hint?.className).toContain("flex-col");
    expect(hint?.className).toContain("items-center");
    expect(hint?.className).not.toContain("border");
    expect(hint?.className).not.toContain("bg-card");
    expect(hint?.textContent).toBe("StatsPlace Right");
    expect(view.leaf.className).toContain("ring-primary");
    expect(screen.getByText("Place Right")).toBeTruthy();
    expect(document.querySelector("[data-drag-ghost]")).toBeNull();
  });

  it("switches to explicit invalid feedback and refuses the drop outside a panel", () => {
    const view = renderStatsLeaf();
    const elementsFromPoint = vi.fn(() => [view.body, view.leaf]);
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: elementsFromPoint,
    });

    fireEvent.mouseDown(view.container.querySelector("[data-panel-title-group]"), {
      clientX: 100,
      clientY: 15,
    });
    fireEvent.mouseMove(window, { clientX: 190, clientY: 80 });
    elementsFromPoint.mockReturnValue([]);
    fireEvent.mouseMove(window, { clientX: 240, clientY: 160 });

    expect(view.container.querySelector("[data-drop-preview]")).toBeNull();
    expect(screen.getByText("Stats · No Drop Target")).toBeTruthy();
    expect(document.querySelector("[data-drag-ghost]")?.dataset.dropValid).toBe("false");
    expect(document.querySelector("[data-drag-ghost]")?.className).not.toContain("border");
    expect(document.querySelector("[data-drag-ghost]")?.className).not.toContain("bg-card");

    fireEvent.mouseUp(window, { clientX: 240, clientY: 160 });
    expect(view.onDrop).not.toHaveBeenCalled();
  });

  it("labels title-bar placement as a tab insertion and commits its index", () => {
    const view = renderStatsLeaf();
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => [view.tabs, view.leaf]),
    });

    fireEvent.mouseDown(view.container.querySelector("[data-panel-title-group]"), {
      clientX: 100,
      clientY: 15,
    });
    fireEvent.mouseMove(window, { clientX: 190, clientY: 15 });

    const tabHint = view.tabs.querySelector("[data-drop-hint]");
    expect(tabHint?.className).toContain("flex-col");
    expect(tabHint?.className).toContain("items-center");
    expect(tabHint?.className).not.toContain("border");
    expect(tabHint?.className).not.toContain("bg-card");
    expect(tabHint?.textContent).toBe("StatsAdd as Tab");
    expect(view.leaf.className).toContain("ring-primary");
    expect(view.tabs.className).not.toContain("border-t-primary");
    expect(view.tabs.querySelector("[data-tab-insert-marker]")).toBeNull();
    fireEvent.mouseUp(window, { clientX: 190, clientY: 15 });
    expect(view.onDrop).toHaveBeenCalledWith(
      { kind: "move", id: "stats" },
      { targetPath: [], zone: "tabs", tabIndex: 1 }
    );
  });
});
