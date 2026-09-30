/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { SettingsRangeInput, SettingsNumberInput } from "./PanelSettingsContent.jsx";

describe("Settings numeric drafts", () => {
  it("cancels a range edit without committing on blur", () => {
    const commit = vi.fn();
    render(
      <SettingsRangeInput
        minAriaLabel="minimum"
        maxAriaLabel="maximum"
        minValue={-60}
        maxValue={0}
        onCommit={commit}
      />
    );
    const input = screen.getByLabelText("minimum");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "-40" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("-60");
    expect(commit).not.toHaveBeenCalled();
  });
  it("does not commit an empty number as zero", () => {
    const commit = vi.fn();
    render(<SettingsNumberInput ariaLabel="number" value={5} min={0} max={10} onCommit={commit} />);
    const input = screen.getByLabelText("number");
    fireEvent.change(input, { target: { value: " " } });
    fireEvent.blur(input);
    expect(input.value).toBe("5");
    expect(commit).not.toHaveBeenCalled();
  });
  it("restores an empty range bound instead of changing it to zero", () => {
    const commit = vi.fn();
    render(
      <SettingsRangeInput
        minAriaLabel="minimum"
        maxAriaLabel="maximum"
        minValue={-60}
        maxValue={0}
        onCommit={commit}
      />
    );
    const input = screen.getByLabelText("minimum");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(input.value).toBe("-60");
    expect(commit).not.toHaveBeenCalled();
  });
});
