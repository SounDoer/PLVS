/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ModulesPopoverContent } from "./WorkspaceToolbar.jsx";
import { WorkspaceProvider } from "./WorkspaceContext.jsx";
import { DragProvider } from "./DragContext.jsx";
import { MetricsDataProvider } from "./AudioDataContext.jsx";
import { LeafView } from "./LeafView.jsx";

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

  it("highlights the corresponding panel frame while hovering a module row", () => {
    const { container } = render(
      <WorkspaceProvider>
        <DragProvider onDrop={vi.fn()}>
          <MetricsDataProvider value={{ statsMetrics: [] }}>
            <ModulesPopoverContent />
            <LeafView node={{ type: "leaf", tabs: ["stats"], activeTab: "stats" }} path={[]} />
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
