/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ModulesPopoverContent } from "./WorkspaceToolbar.jsx";
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
});
