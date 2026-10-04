/** @vitest-environment jsdom */
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PalettesPage } from "./PalettesPage.jsx";
import { BUILTIN_THEMES_V2 } from "../../theme/builtinThemesV2.js";
import { applyPalettePreset } from "../../theme/palettePresets.js";

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

it("keeps Custom intensity stops across preset comparisons until Reset Custom", () => {
  function Harness() {
    const [draft, setDraft] = useState(() => structuredClone(BUILTIN_THEMES_V2["plvs-dark"]));
    const setIntensity = (intensity) =>
      setDraft((current) => ({
        ...current,
        palettes: { ...current.palettes, intensity },
      }));
    return (
      <PalettesPage
        draft={draft}
        onColor={vi.fn()}
        onStop={vi.fn()}
        onStops={(stops) => setIntensity({ presetId: null, stops })}
        onApplyPreset={(kind, presetId) => {
          if (kind === "intensity") setIntensity(applyPalettePreset(kind, presetId));
        }}
      />
    );
  }

  render(<Harness />);
  const addStop = screen.getByRole("button", { name: "Add Stop" });
  expect(addStop.parentElement.lastElementChild).toBe(addStop);
  expect(screen.getByLabelText("Reset Custom intensity palette").disabled).toBe(true);

  fireEvent.click(addStop);
  expect(screen.getByRole("button", { name: "Stop 12" })).toBeTruthy();
  expect(screen.getByLabelText("intensity palette preset").textContent).toContain("Custom");
  expect(screen.getByLabelText("Reset Custom intensity palette").disabled).toBe(false);

  fireEvent.click(screen.getByLabelText("intensity palette preset"));
  fireEvent.click(screen.getByRole("option", { name: "Viridis" }));
  expect(screen.queryByRole("button", { name: "Stop 12" })).toBeNull();

  fireEvent.click(screen.getByLabelText("intensity palette preset"));
  fireEvent.click(screen.getByRole("option", { name: "Custom" }));
  expect(screen.getByRole("button", { name: "Stop 12" })).toBeTruthy();

  fireEvent.click(screen.getByLabelText("Reset Custom intensity palette"));
  fireEvent.click(screen.getByLabelText("Confirm reset Custom intensity palette"));
  expect(screen.queryByRole("button", { name: "Stop 12" })).toBeNull();
  expect(screen.getByLabelText("intensity palette preset").textContent).toContain("Viridis");
  expect(screen.getByLabelText("Reset Custom intensity palette").disabled).toBe(true);

  fireEvent.click(screen.getByLabelText("intensity palette preset"));
  expect(screen.queryByRole("option", { name: "Custom" })).toBeNull();
});

it("offers the shared PLVS reset for a customized Interface palette", () => {
  const draft = structuredClone(BUILTIN_THEMES_V2["plvs-dark"]);
  draft.palettes.interface = {
    ...draft.palettes.interface,
    presetId: null,
    success: "#000000",
  };
  const onApplyPreset = vi.fn();

  render(
    <PalettesPage
      draft={draft}
      onColor={vi.fn()}
      onStop={vi.fn()}
      onStops={vi.fn()}
      onApplyPreset={onApplyPreset}
    />
  );

  fireEvent.click(screen.getByLabelText("Reset interface palette to PLVS"));
  fireEvent.click(screen.getByLabelText("Confirm reset interface palette to PLVS"));
  expect(onApplyPreset).toHaveBeenCalledWith("interface", "interface-plvs");
});
