/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoudnessLayoutMarker, UNKNOWN_LAYOUT_TIP } from "./LoudnessLayoutMarker.jsx";

describe("LoudnessLayoutMarker", () => {
  it("renders nothing while the layout is known or not yet reported", () => {
    const { container, rerender } = render(<LoudnessLayoutMarker known={true} />);
    expect(container.textContent).toBe("");
    rerender(<LoudnessLayoutMarker known={undefined} />);
    expect(container.textContent).toBe("");
  });

  it("marks Ch1/Ch2 loudness and explains it on hover", () => {
    render(<LoudnessLayoutMarker known={false} />);
    const marker = screen.getByTestId("loudness-layout-marker");
    expect(marker.textContent).toBe("Ch 1–2");
    fireEvent.mouseEnter(marker);
    expect(screen.getByText(UNKNOWN_LAYOUT_TIP)).toBeTruthy();
  });

  it("uses Dock caption typography when dense, normal-panel typography otherwise", () => {
    const { rerender } = render(<LoudnessLayoutMarker known={false} dense />);
    let marker = screen.getByTestId("loudness-layout-marker");
    expect(marker.textContent).toBe("Ch 1–2");
    expect(marker.className).toContain("--ui-dock-fs-caption");

    rerender(<LoudnessLayoutMarker known={false} />);
    marker = screen.getByTestId("loudness-layout-marker");
    expect(marker.className).not.toContain("--ui-dock-fs-caption");
  });
});
