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

  it("groups Status, Intensity, and Frequency on one palettes page", () => {
    render(<ThemeEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Palettes" }));

    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Intensity")).toBeTruthy();
    expect(screen.getByText("Frequency")).toBeTruthy();
    expect(screen.getByLabelText("Intensity palette preview")).toBeTruthy();
  });

  it("shows curated Advanced roles rather than raw token names", () => {
    render(<ThemeEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));

    expect(screen.getByText("Panel Surface")).toBeTruthy();
    expect(screen.getByText("Annotation Text")).toBeTruthy();
    expect(screen.queryByText("Focus Color")).toBeNull();
    expect(screen.getByText("Waveform")).toBeTruthy();
    expect(screen.queryByText(/--/)).toBeNull();
  });

  it("orders Advanced sections by the Module Catalog and shows Interface subgroups", () => {
    render(<ThemeEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));

    for (const group of ["Surfaces", "Text & Icons", "Feedback", "Contrast", "Effects"]) {
      expect(screen.getByText(group)).toBeTruthy();
    }
    const sectionNames = [
      "Interface",
      "Activity",
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
    fireEvent.click(interfaceSection);
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
    fireEvent.click(screen.getByRole("button", { name: "Reset Section to Auto" }));
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
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Theme Preview" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Theme Preview" })).toBeNull();
  });

  it("summarizes visual warnings and jumps to the related role", async () => {
    const draft = structuredClone(DRAFT);
    draft.overrides["interface.surface.control"] = { kind: "color", value: "#222222" };
    draft.overrides["interface.surface.muted"] = { kind: "color", value: "#222222" };
    render(<ThemeEditor {...BASE_PROPS} draft={draft} />);
    expect(screen.getByText(/Visual Warning/)).toBeTruthy();
    expect(screen.getByText(/Roles: interface\.surface\.control/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review interface.surface.muted" }));

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
    ["Palettes", "status palette preset", "PLVS Default"],
    ["Advanced", "Panel Surface mode", "Auto"],
  ])("dresses the %s dropdown as the shared Select, not a bare <select>", (tab, label, shown) => {
    render(<ThemeEditor {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole("tab", { name: tab }));

    const trigger = screen.getByLabelText(label);
    expect(trigger.tagName).not.toBe("SELECT");
    expect(trigger.getAttribute("data-slot")).toBe("select-trigger");
    expect(trigger.textContent).toContain(shown);
  });

  it("exposes disabled Undo and Redo actions until history exists", () => {
    render(<ThemeEditor {...BASE_PROPS} />);

    expect(screen.getByRole("button", { name: "Undo theme change" }).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Redo theme change" }).disabled).toBe(true);
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
