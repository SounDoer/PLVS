/** @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimelineSelectionEdgeHint } from "./TimelineSelectionEdgeHint.jsx";

describe("TimelineSelectionEdgeHint", () => {
  it.each(["left", "right"])("points toward an off-window selection on the %s", (direction) => {
    render(<TimelineSelectionEdgeHint direction={direction} />);

    const hint = screen.getByTestId("timeline-selection-edge-hint");
    expect(hint.getAttribute("data-direction")).toBe(direction);
    expect(hint.getAttribute("aria-hidden")).toBe("true");
  });

  it("renders nothing when the selection is inside the viewport", () => {
    const { container } = render(<TimelineSelectionEdgeHint direction={null} />);
    expect(container.firstChild).toBeNull();
  });
});
