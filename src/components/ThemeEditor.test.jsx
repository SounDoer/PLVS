/** @vitest-environment jsdom */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ThemeEditor } from "./ThemeEditor.jsx";
import { makeCustomThemeV2FromBase } from "../theme/customTheme.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";

const DRAFT = makeCustomThemeV2FromBase(
  BUILTIN_THEMES_V2["plvs-dark"],
  "My Theme",
  () => "custom-1"
);

const BASE_PROPS = {
  draft: DRAFT,
  onName: vi.fn(),
  onCore: vi.fn(),
  onPaletteColor: vi.fn(),
  onIntensityStop: vi.fn(),
  onIntensityStops: vi.fn(),
  onApplyPreset: vi.fn(),
  onOverride: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  canUndo: false,
  canRedo: false,
  canSave: true,
  onSave: vi.fn(),
  onCancel: vi.fn(),
  dirty: false,
  pos: { x: 10, y: 20 },
  onMove: vi.fn(),
};

describe("ThemeEditor", () => {
  it("previews fixed fills without attenuating trace strokes", () => {
    const draft = structuredClone(DRAFT);
    render(<ThemeEditor {...BASE_PROPS} draft={draft} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Theme Preview" }));
    const preview = screen.getByRole("dialog", { name: "Theme Preview" });
    expect(preview.style.colorScheme).toBe("dark");
    fireEvent.click(screen.getByRole("tab", { name: "Modules" }));
    const spectrum = screen.getByText("Spectrum").closest("section");
    expect(spectrum.querySelector('stop[offset="0%"]').getAttribute("stop-opacity")).toBe("0.2");
    expect(spectrum.querySelector('stop[offset="100%"]').getAttribute("stop-opacity")).toBe("0.02");
    const stereoMap = screen.getByText("Stereo Map").closest("section");
    expect(stereoMap.querySelector("stop").getAttribute("stop-opacity")).toBe("0.2");
    const waveform = screen.getByText("Waveform").closest("section");
    expect(waveform.querySelector("path").getAttribute("fill-opacity")).toBe("0.12");
    expect(preview.querySelectorAll("[stroke-opacity], [opacity]")).toHaveLength(0);
  });
  it("warns without replacing a stale Theme draft", () => {
    render(<ThemeEditor {...BASE_PROPS} stale />);

    expect(screen.getByText(/changed in another PLVS workbench/i)).toBeTruthy();
  });

  it("shows a compact appearance control beside the Theme identity", () => {
    const onColorScheme = vi.fn();
    render(<ThemeEditor {...BASE_PROPS} onColorScheme={onColorScheme} />);

    const group = screen.getByRole("group", { name: "Theme appearance" });
    expect(group).toBeTruthy();
    expect(screen.getByRole("button", { name: "dark" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "light" }));
    expect(onColorScheme).toHaveBeenCalledWith("light");
  });

  it("shows six understandable core color roles without alpha controls", () => {
    render(<ThemeEditor {...BASE_PROPS} />);

    for (const label of [
      "Workspace",
      "Surface",
      "Text",
      "Interface Accent",
      "Primary Data",
      "Secondary Data",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.queryByLabelText("Workspace alpha")).toBeNull();
  });

  it("resets Core Colors as one confirmed action", () => {
    const draft = structuredClone(DRAFT);
    draft.core.workspace = "#123456";
    const onResetCore = vi.fn();
    render(<ThemeEditor {...BASE_PROPS} draft={draft} onResetCore={onResetCore} />);

    fireEvent.click(screen.getByLabelText("Reset Core Colors to Dark defaults"));
    fireEvent.click(screen.getByLabelText("Confirm reset Core Colors"));
    expect(onResetCore).toHaveBeenCalledOnce();
  });

  it("groups Status, Intensity, Frequency, and Interface on one palettes page", () => {
    render(<ThemeEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Palettes" }));

    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Intensity")).toBeTruthy();
    expect(screen.getByText("Frequency")).toBeTruthy();
    expect(screen.getByText("Interface")).toBeTruthy();
    expect(screen.getByLabelText("Intensity palette preview")).toBeTruthy();
  });

  it("shows stale preset provenance as Custom when the stops no longer match", () => {
    const draft = structuredClone(DRAFT);
    draft.palettes.intensity.stops = draft.palettes.intensity.stops.filter(
      (_, index) => index % 2 === 0
    );
    render(<ThemeEditor {...BASE_PROPS} draft={draft} />);
    fireEvent.click(screen.getByRole("tab", { name: "Palettes" }));

    expect(screen.getByLabelText("intensity palette preset").textContent).toContain("Custom");
  });

  it("shows disabled reset actions for shared PLVS palettes", () => {
    const draft = makeCustomThemeV2FromBase(
      BUILTIN_THEMES_V2["plvs-light"],
      "Light Theme",
      () => "custom-light"
    );
    render(<ThemeEditor {...BASE_PROPS} draft={draft} />);
    fireEvent.click(screen.getByRole("tab", { name: "Palettes" }));

    expect(screen.queryByLabelText("status palette preset")).toBeNull();
    expect(screen.queryByLabelText("frequency palette preset")).toBeNull();
    expect(screen.queryByLabelText("interface palette preset")).toBeNull();
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByLabelText("Reset status palette to PLVS"))
        .disabled
    ).toBe(true);
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByLabelText("Reset frequency palette to PLVS"))
        .disabled
    ).toBe(true);
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByLabelText("Reset interface palette to PLVS"))
        .disabled
    ).toBe(true);
    expect(document.querySelector('[data-palette-preset-action="status"]').className).toContain(
      "w-10"
    );
    expect(document.querySelector('[data-palette-preset-action="frequency"]').className).toContain(
      "w-10"
    );
    expect(document.querySelector('[data-palette-preset-action="interface"]').className).toContain(
      "w-10"
    );
  });

  it("offers one-click PLVS resets after simple palettes are customized", () => {
    const draft = structuredClone(DRAFT);
    draft.palettes.status.safe = "#abcdef";
    draft.palettes.frequency.low = "#fedcba";
    draft.palettes.interface.success = "#123456";
    const onApplyPreset = vi.fn();
    render(<ThemeEditor {...BASE_PROPS} draft={draft} onApplyPreset={onApplyPreset} />);
    fireEvent.click(screen.getByRole("tab", { name: "Palettes" }));

    fireEvent.click(screen.getByLabelText("Reset status palette to PLVS"));
    fireEvent.click(screen.getByLabelText("Confirm reset status palette to PLVS"));
    fireEvent.click(screen.getByLabelText("Reset frequency palette to PLVS"));
    fireEvent.click(screen.getByLabelText("Confirm reset frequency palette to PLVS"));
    fireEvent.click(screen.getByLabelText("Reset interface palette to PLVS"));
    fireEvent.click(screen.getByLabelText("Confirm reset interface palette to PLVS"));
    expect(onApplyPreset).toHaveBeenNthCalledWith(1, "status", "status-plvs");
    expect(onApplyPreset).toHaveBeenNthCalledWith(2, "frequency", "frequency-plvs");
    expect(onApplyPreset).toHaveBeenNthCalledWith(3, "interface", "interface-plvs");
  });

  it("shows curated Advanced roles rather than raw token names", () => {
    render(<ThemeEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    fireEvent.click(screen.getByRole("button", { name: "Interface" }));

    expect(screen.getByText("Panel Surface")).toBeTruthy();
    expect(screen.getByText("Annotation Text")).toBeTruthy();
    expect(screen.queryByText("Focus Color")).toBeNull();
    expect(screen.getByText("Waveform")).toBeTruthy();
    expect(screen.queryByText(/--/)).toBeNull();
  });

  it.each(["Spectrum", "Stereo Map", "Waveform"])(
    "hides fill-opacity controls in %s, without numeric settings",
    (section) => {
      const draft = structuredClone(DRAFT);

      const before = structuredClone(draft);
      const onOverride = vi.fn();
      render(<ThemeEditor {...BASE_PROPS} draft={draft} onOverride={onOverride} />);
      fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
      fireEvent.click(screen.getByRole("button", { name: section }));
      expect(screen.queryByText(/Fill Opacity/)).toBeNull();
      expect(screen.queryByRole("slider")).toBeNull();
      expect(onOverride).not.toHaveBeenCalled();
      expect(draft).toEqual(before);
    }
  );

  it("orders Advanced sections by the Module Catalog and shows Interface subgroups", () => {
    render(<ThemeEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    const allSections = screen.getAllByRole("button", { expanded: false });
    expect(allSections.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Interface" }));

    for (const group of ["Surfaces", "Text & Icons", "Feedback", "Contrast", "Effects"]) {
      expect(screen.getByText(group)).toBeTruthy();
    }
    const sectionNames = [
      "Interface",
      "Transport",
      "Level Meter",
      "Loudness",
      "Stats",
      "Vectorscope",
      "Spectrum",
      "Spectrogram",
      "Waveform",
      "Stereo Map",
    ];
    const sections = sectionNames.map((name) => screen.getByRole("button", { name }));
    for (let index = 1; index < sections.length; index += 1) {
      expect(sections[index - 1].compareDocumentPosition(sections[index]) & 4).toBeTruthy();
    }
  });

  it("searches Advanced roles without replacing the saved expansion state", () => {
    render(<ThemeEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    const interfaceSection = screen.getByRole("button", { name: "Interface" });
    expect(interfaceSection.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Panel Surface")).toBeNull();

    fireEvent.change(screen.getByLabelText("Search Advanced roles"), {
      target: { value: "Panel Surface" },
    });
    expect(screen.getByText("Panel Surface")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search Advanced roles"), { target: { value: "" } });
    expect(screen.queryByText("Panel Surface")).toBeNull();
  });

  it("shows customized counts and resets a whole section to Auto", () => {
    const draft = structuredClone(DRAFT);
    draft.overrides["waveform.trace"] = { kind: "color", value: "#123456" };
    const onResetOverrides = vi.fn();
    render(<ThemeEditor {...BASE_PROPS} draft={draft} onResetOverrides={onResetOverrides} />);
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByText("1 Custom")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset Waveform section to Auto" }));
    fireEvent.click(screen.getByLabelText("Confirm reset Waveform section to Auto"));
    expect(onResetOverrides).toHaveBeenCalledWith(
      expect.arrayContaining(["waveform.trace", "waveform.snapshot"])
    );
  });

  it("moves individual descriptions into a bounded HoverTip with an accessible equivalent", () => {
    render(<ThemeEditor {...BASE_PROPS} />);
    const workspace = screen.getByRole("button", { name: "Workspace" });
    expect(workspace.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.mouseEnter(workspace);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("app canvas behind panels");
    expect(tooltip.className).toContain("max-w-64");
  });

  it("opens a read-only controlled preview against the current Draft", () => {
    render(<ThemeEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Theme Preview" }));

    expect(screen.getByRole("dialog", { name: "Theme Preview" })).toBeTruthy();
    expect(screen.getByText("Controlled scenes from the current unsaved Draft")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Modules" }));
    expect(screen.getByText("Stereo Map")).toBeTruthy();
    expect(document.querySelectorAll("[data-theme-preview-grid]")).toHaveLength(4);
    expect(document.querySelector("[data-theme-preview-guides]")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Theme Preview" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Theme Preview" })).toBeNull();
  });

  it("keeps visual findings in Preview and jumps back to the related role", async () => {
    const draft = structuredClone(DRAFT);
    draft.overrides["interface.surface.control"] = { kind: "color", value: "#222222" };
    draft.overrides["interface.surface.muted"] = { kind: "color", value: "#222222" };
    render(<ThemeEditor {...BASE_PROPS} draft={draft} />);
    expect(screen.queryByText(/Control and Muted Surface are difficult to distinguish/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Theme Preview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Visual Review" }));
    expect(screen.getByRole("heading", { name: "Visual Review" })).toBeTruthy();
    expect(screen.getByText(/Roles: interface\.surface\.control/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review interface.surface.muted" }));

    expect(screen.queryByRole("dialog", { name: "Theme Preview" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Advanced" }).getAttribute("aria-selected")).toBe(
      "true"
    );
    await waitFor(() =>
      expect(document.querySelector('[data-theme-target="interface.surface.muted"]')).toBeTruthy()
    );
  });

  it("shows the name statically and opens editing from the rename icon", () => {
    render(<ThemeEditor {...BASE_PROPS} />);
    expect(screen.queryByLabelText("Theme name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rename theme" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Theme name"));
  });

  it.each([
    ["Palettes", "intensity palette preset", "Inferno"],
    ["Advanced", "Panel Surface mode", "Auto"],
  ])("dresses the %s dropdown as the shared Select, not a bare <select>", (tab, label, shown) => {
    render(<ThemeEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    if (tab === "Advanced") fireEvent.click(screen.getByRole("button", { name: "Interface" }));

    const trigger = screen.getByLabelText(label);
    expect(trigger.tagName).not.toBe("SELECT");
    expect(trigger.getAttribute("data-slot")).toBe("select-trigger");
    expect(trigger.textContent).toContain(shown);
  });

  it("exposes disabled Undo and Redo actions until history exists", () => {
    render(<ThemeEditor {...BASE_PROPS} />);

    expect(
      /** @type {HTMLButtonElement} */ (screen.getByRole("button", { name: "Undo theme change" }))
        .disabled
    ).toBe(true);
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByRole("button", { name: "Redo theme change" }))
        .disabled
    ).toBe(true);
  });

  it("commits a name edit from the confirm button", () => {
    const onName = vi.fn();
    render(<ThemeEditor {...BASE_PROPS} onName={onName} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename theme" }));
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save theme name" }));
    expect(onName).toHaveBeenCalledWith("Renamed");
    expect(screen.queryByLabelText("Theme name")).toBeNull();
  });

  it("discards a name edit from the cancel button", () => {
    const onName = vi.fn();
    render(<ThemeEditor {...BASE_PROPS} onName={onName} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename theme" }));
    fireEvent.change(screen.getByLabelText("Theme name"), { target: { value: "Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel rename" }));
    expect(onName).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Theme name")).toBeNull();
  });

  it("uses an app dialog when cancelling dirty edits", () => {
    const onCancel = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm");

    render(<ThemeEditor {...BASE_PROPS} dirty={true} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "Discard theme changes?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep Editing" }));
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog", { name: "Discard theme changes?" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard Changes" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    confirmSpy.mockRestore();
  });
});
