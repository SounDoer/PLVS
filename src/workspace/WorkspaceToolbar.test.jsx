/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ModulesPopoverContent, VisibilityPopover } from "./WorkspaceToolbar.jsx";
import { WorkspaceProvider } from "./WorkspaceContext.jsx";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }) => <div {...props}>{children}</div>,
  },
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
    expect(actions?.className).not.toContain("group-focus-within:opacity-100");
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

  it("uses content-sized popover width instead of a fixed modules width", () => {
    render(
      <WorkspaceProvider>
        <VisibilityPopover />
      </WorkspaceProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Modules" }));
    const content = screen.getByText("Modules").closest("[data-slot='popover-content']");
    expect(content?.className).toContain("w-max");
    expect(content?.className).not.toContain("w-52");
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
});
