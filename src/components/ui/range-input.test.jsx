/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RangeInput } from "./range-input.jsx";

describe("RangeInput feedback", () => {
  it("leaves pointer capture to the native range input", () => {
    render(<RangeInput aria-label="speed" defaultValue={40} />);
    const slider = screen.getByRole("slider");
    slider.setPointerCapture = vi.fn();

    fireEvent.pointerDown(slider, { button: 0, pointerId: 1 });

    expect(slider.setPointerCapture).not.toHaveBeenCalled();
  });

  it("keeps the value visible outside the track while dragging and clears on cancellation", () => {
    render(<RangeInput aria-label="speed" valueLabel="40%" defaultValue={40} />);
    const slider = screen.getByRole("slider");
    fireEvent(slider, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    fireEvent.mouseLeave(slider);
    expect(slider.dataset.adjusting).toBe("true");
    expect(screen.getByRole("tooltip").textContent).toBe("40%");
    fireEvent.pointerCancel(slider);
    expect(slider.dataset.adjusting).toBeUndefined();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
  it("shows keyboard adjustment only while an adjustment key is held", () => {
    const onKeyUp = vi.fn();
    render(<RangeInput aria-label="speed" onKeyUp={onKeyUp} defaultValue={40} />);
    const slider = screen.getByRole("slider");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(slider.dataset.adjusting).toBe("true");
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(slider.dataset.adjusting).toBeUndefined();
    expect(onKeyUp).toHaveBeenCalledOnce();
  });
});
