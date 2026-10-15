/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockViews } from "./DockViews.jsx";

describe("Dock Views", () => {
  it("offers annotations without inventing a panel header control", () => {
    const onAction = vi.fn();
    render(<DockViews state={{ edge: "bottom", hideAxesAndLabels: true }} onAction={onAction} />);
    expect(screen.queryByRole("switch", { name: "Hide Panel Headers" })).toBeNull();
    fireEvent.click(screen.getByRole("switch", { name: "Hide Axes & Labels" }));
    expect(onAction).toHaveBeenCalledWith("set-hide-axes-labels", { value: false });
  });
});
