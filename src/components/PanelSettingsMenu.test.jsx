/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { PanelSettingsMenu } from "./PanelSettingsMenu.jsx";
import { DEFAULT_PANEL_CONTROLS } from "@/lib/panelControls.js";
import { BlockingEditorsProvider } from "@/hooks/BlockingEditorsContext.jsx";
import {
  UiNavigationProvider,
  useUiNavigation,
  useUiNavigationTarget,
} from "@/uiNavigation/UiNavigationContext.jsx";

describe("PanelSettingsMenu", () => {
  it("opens the exact Panel instance through semantic navigation", async () => {
    /** @type {any} */
    let navigation;
    const prepare = vi.fn();
    function Harness() {
      navigation = useUiNavigation();
      useUiNavigationTarget("panelSettings", { prepare });
      return (
        <PanelSettingsMenu
          panelId="stats"
          activeTab="levelMeter"
          panelControls={DEFAULT_PANEL_CONTROLS}
          onPanelControlsChange={vi.fn()}
          panelTitle="Broadcast Meter"
          onPanelControlsReset={vi.fn()}
        />
      );
    }
    render(
      <BlockingEditorsProvider>
        <UiNavigationProvider getRevision={() => 9}>
          <Harness />
        </UiNavigationProvider>
      </BlockingEditorsProvider>
    );
    let pending;

    await act(async () => {
      pending = navigation.showPanelSettings({
        panelId: "stats",
        expectedRevision: 9,
        expectedUiGeneration: 0,
      });
      await Promise.resolve();
    });
    const response = await pending;

    expect(prepare).toHaveBeenCalledWith({ panelId: "stats" });
    expect(screen.getByRole("heading", { name: "Broadcast Meter" })).toBeTruthy();
    expect(response).toMatchObject({
      changed: true,
      uiGeneration: 1,
      surface: {
        kind: "panelSettings",
        target: { panelId: "stats", presentation: "normal" },
      },
    });

    await expect(
      navigation.showPanelSettings({
        panelId: "stats",
        expectedRevision: 9,
        expectedUiGeneration: 1,
      })
    ).resolves.toMatchObject({ changed: false, uiGeneration: 1 });
  });

  it("dismisses a nested selector before closing panel settings", () => {
    const onChange = vi.fn();
    render(
      <PanelSettingsMenu
        activeTab="levelMeter"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onChange}
        panelTitle={undefined}
        onPanelControlsReset={undefined}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "level meter mode" }), {
      key: "ArrowDown",
    });
    fireEvent.keyDown(screen.getByRole("option", { name: "Momentary" }), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox", { name: "level meter mode" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "level meter mode" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("exposes Waveform settings from the panel header", () => {
    render(
      <PanelSettingsMenu
        activeTab="waveform"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
        onPanelControlsReset={vi.fn()}
        panelTitle={undefined}
      />
    );

    fireEvent.click(screen.getByLabelText("Panel settings"));
    expect(screen.getByText("Waveform")).toBeTruthy();
    expect(screen.getByLabelText("waveform frequency color")).toBeTruthy();
  });

  it("renders a single settings trigger and opens level meter settings", () => {
    const onPanelControlsChange = vi.fn();

    render(
      <PanelSettingsMenu
        activeTab="levelMeter"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={onPanelControlsChange}
        panelTitle={undefined}
        onPanelControlsReset={undefined}
      />
    );

    expect(screen.queryByLabelText("level meter mode")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));

    const content = screen
      .getByLabelText("level meter mode")
      .closest("[data-slot='popover-content']");
    const contentClasses = content?.className.split(/\s+/) ?? [];
    expect(contentClasses).toContain("p-1");
    expect(contentClasses).not.toContain("p-2");
    expect(contentClasses).toContain("max-h-[var(--radix-popover-content-available-height)]");
    expect(contentClasses).toContain("overflow-hidden");

    const scrollArea = content?.querySelector("[data-panel-settings-scroll]");
    const scrollAreaClasses = scrollArea?.className.split(/\s+/) ?? [];
    expect(scrollAreaClasses).toContain("min-h-0");
    expect(scrollAreaClasses).toContain("overflow-y-auto");
    expect(scrollAreaClasses).toContain("overscroll-contain");

    expect(screen.getByLabelText("level meter mode")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "level meter mode" })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "level meter mode" }), {
      key: "ArrowDown",
    });
    fireEvent.click(screen.getByRole("option", { name: "Momentary" }));
    expect(screen.getByText("Mode")).toBeTruthy();

    expect(onPanelControlsChange).toHaveBeenCalledWith({
      ...DEFAULT_PANEL_CONTROLS,
      levelMeterMode: "momentary",
    });
  });

  it("hides the trigger when the panel has no settings", () => {
    const { container } = render(
      <PanelSettingsMenu
        activeTab="waveform"
        panelTitle={undefined}
        onPanelControlsReset={undefined}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("uses the panel instance title and confirms a scoped reset", () => {
    const onPanelControlsReset = vi.fn();
    render(
      <PanelSettingsMenu
        activeTab="levelMeter"
        panelTitle="Broadcast Meter"
        panelControls={{ ...DEFAULT_PANEL_CONTROLS, levelMeterMode: "rms" }}
        onPanelControlsChange={vi.fn()}
        onPanelControlsReset={onPanelControlsReset}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));

    expect(screen.getByRole("heading", { name: "Broadcast Meter" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset Broadcast Meter settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset Broadcast Meter settings" }));
    expect(onPanelControlsReset).toHaveBeenCalledOnce();
  });

  it("disables reset while the panel already uses defaults", () => {
    render(
      <PanelSettingsMenu
        activeTab="levelMeter"
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
        onPanelControlsReset={vi.fn()}
        panelTitle={undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));
    expect(
      /** @type {HTMLButtonElement} */ (
        screen.getByRole("button", { name: "Reset Level Meter settings" })
      ).disabled
    ).toBe(true);
  });

  it("renders spectrogram settings trigger when only range controls are available", () => {
    render(
      <PanelSettingsMenu
        activeTab="spectrogram"
        channelCount={2}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
        panelTitle={undefined}
        onPanelControlsReset={undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));

    expect(screen.getByLabelText("spectrogram frequency range min")).toBeTruthy();
    expect(screen.getByLabelText("spectrogram frequency range max")).toBeTruthy();
  });

  it("renders Vectorscope settings for stereo sources", () => {
    render(
      <PanelSettingsMenu
        activeTab="vectorscope"
        channelCount={2}
        vectorscopeOptions={[{ key: "0-1", label: "L/R", x: 0, y: 1 }]}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
        panelTitle={undefined}
        onPanelControlsReset={undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));
    expect(screen.getByLabelText("vectorscope mode")).toBeTruthy();
    expect(screen.queryByLabelText("vectorscope channel pair")).toBeNull();
  });

  it("renders Stereo Map settings, including the channel pair selector", () => {
    render(
      <PanelSettingsMenu
        activeTab="stereo-map"
        channelCount={2}
        stereoMapPairOptions={[{ key: "0-1", label: "L/R", x: 0, y: 1 }]}
        panelControls={DEFAULT_PANEL_CONTROLS}
        onPanelControlsChange={vi.fn()}
        panelTitle={undefined}
        onPanelControlsReset={undefined}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Panel settings" }));
    expect(screen.getByRole("combobox", { name: "stereo map mode" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "stereo map channel" })).toBeTruthy();
  });
});
