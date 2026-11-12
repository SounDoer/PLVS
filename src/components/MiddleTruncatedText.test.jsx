/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MiddleTruncatedText } from "./MiddleTruncatedText.jsx";

const LONG = "DI21_mus_IntroTutorial_cue01_BPM196_6-8_v03.wav";

function mockOverflow(overflowing) {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(overflowing ? 200 : 100);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
}

afterEach(() => vi.restoreAllMocks());

describe("MiddleTruncatedText", () => {
  it("splits a long name before the trailing stem characters and extension", () => {
    const { container } = render(<MiddleTruncatedText text={LONG} />);
    const root = container.firstElementChild;
    expect(root.textContent).toBe(LONG);
    const [head, tail] = root.children;
    expect(head.textContent).toBe("DI21_mus_IntroTutorial_cue01_BPM196_");
    expect(tail.textContent).toBe("6-8_v03.wav");
  });

  it("renders a short name as one span", () => {
    const { container } = render(<MiddleTruncatedText text="final.wav" />);
    expect(container.firstElementChild.children).toHaveLength(0);
    expect(screen.getByText("final.wav")).toBeTruthy();
  });

  it("shows the full name on hover only when it is truncated", () => {
    mockOverflow(false);
    const { container } = render(<MiddleTruncatedText text={LONG} />);
    const root = container.firstElementChild;
    fireEvent.pointerEnter(root);
    expect(screen.queryByRole("tooltip")).toBeNull();

    mockOverflow(true);
    fireEvent.pointerEnter(root);
    expect(screen.getByRole("tooltip").textContent).toBe(LONG);
    expect(root.getAttribute("title")).toBeNull();

    fireEvent.pointerLeave(root);
    expect(screen.queryByRole("tooltip")).toBeNull();

    mockOverflow(false);
    fireEvent.pointerEnter(root);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("clears the previous filename's tooltip when the displayed file changes", () => {
    mockOverflow(true);
    const { container, rerender } = render(<MiddleTruncatedText text={LONG} />);
    const root = container.firstElementChild;
    fireEvent.pointerEnter(root);
    expect(screen.getByRole("tooltip").textContent).toBe(LONG);

    rerender(<MiddleTruncatedText text="final.wav" />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerEnter(root);
    expect(screen.getByRole("tooltip").textContent).toBe("final.wav");
  });
});
