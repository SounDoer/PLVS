/** @vitest-environment jsdom */
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PalettesPage } from "./PalettesPage.jsx";
import { BUILTIN_THEMES_V2 } from "../../theme/builtinThemesV2.js";

it("keeps a moving stop mounted and its progress aligned with the bounded track", () => {
  function Harness() {
    const [draft, setDraft] = useState(() => {
      const value = structuredClone(BUILTIN_THEMES_V2["plvs-dark"]);
      value.palettes.intensity.stops = [
        { position: 0, color: "#000000" },
        { position: 0.5, color: "#888888" },
        { position: 1, color: "#ffffff" },
      ];
      return value;
    });
    return (
      <PalettesPage
        draft={draft}
        onColor={vi.fn()}
        onStop={vi.fn()}
        onApplyPreset={vi.fn()}
        onStops={(stops) =>
          setDraft({
            ...draft,
            palettes: { ...draft.palettes, intensity: { ...draft.palettes.intensity, stops } },
          })
        }
      />
    );
  }
  render(<Harness />);
  const slider = screen.getByRole("slider", { name: "Stop 2 position" });
  act(() => slider.focus());
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  fireEvent.change(slider, { target: { value: "0.6" } });
  expect(screen.getByRole("slider", { name: "Stop 2 position" })).toBe(slider);
  expect(document.activeElement).toBe(slider);
  expect(slider.dataset.adjusting).toBe("true");
  expect(parseFloat(slider.style.getPropertyValue("--range-pct"))).toBeCloseTo((0.59 / 0.98) * 100);
  fireEvent.keyUp(slider, { key: "ArrowRight" });
  expect(slider.dataset.adjusting).toBeUndefined();
});
