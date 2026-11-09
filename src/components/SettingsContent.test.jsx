/** @vitest-environment jsdom */
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContent } from "./SettingsContent.jsx";
import { SettingsSheetFrame, SettingsWindowFrame } from "./settings/SettingsFrames.jsx";
import { BlockingEditorsProvider } from "../hooks/BlockingEditorsContext.jsx";
import { UiNavigationProvider, useUiNavigation } from "../uiNavigation/UiNavigationContext.jsx";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

function props() {
  return {
    settingsOpen: true,
    setSettingsOpen: vi.fn(),
    appearance: "system",
    setAppearanceMode: vi.fn(),
    fixedThemeSelectValue: "plvs-dark",
    setFixedThemeIdFromPicker: vi.fn(),
    channelCount: 2,
    channelLabelTokens: ["L", "R"],
    channelLabelHasOverride: false,
    selectedLayoutId: "stereo",
    setChannelLayout: vi.fn(),
    setChannelLabelToken: vi.fn(),
    resetChannelLabels: vi.fn(),
    appVersion: "0.24.1",
    latestVersion: undefined,
    releaseUrl: undefined,
    onResetConfiguration: vi.fn(),
    onOpenFeedback: vi.fn(),
    setAutostartEnabled: vi.fn(),
    autostartReady: true,
  };
}

describe("shared Settings content", () => {
  it.each([
    ["normal", SettingsSheetFrame],
    ["Dock", SettingsWindowFrame],
  ])("uses the themed update-error tip in the %s frame", (_name, Frame) => {
    render(
      <SettingsContent
        {...props()}
        Frame={Frame}
        updateStatus="ok"
        hasUpdate
        latestVersion="2.0.0"
        updateActivity={{ readyVersion: "2.0.0", downloadError: "Disk full" }}
      />
    );
    const status = screen.getByText("Update Ready · Download Failed");
    expect(status.getAttribute("title")).toBeNull();
    fireEvent.mouseEnter(status);
    expect(screen.getByRole("tooltip").textContent).toBe("Disk full");
  });

  it("renders identical settings sections and controls through both frames", () => {
    const values = props();
    const view = render(<SettingsContent {...values} Frame={SettingsSheetFrame} />);
    const sections = () =>
      [...document.querySelectorAll("[data-settings-section-id]")].map((node) =>
        node.getAttribute("data-settings-section-id")
      );
    const controls = () =>
      screen
        .getAllByRole("button")
        .map((node) => node.getAttribute("aria-label") ?? node.textContent);
    const normalSections = sections();
    const normalControls = controls();
    view.rerender(<SettingsContent {...values} Frame={SettingsWindowFrame} />);
    expect(sections()).toEqual(normalSections);
    expect(controls()).toEqual(normalControls);
    fireEvent.click(screen.getByRole("switch", { name: "Open at Login" }));
    expect(values.setAutostartEnabled).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect(values.onOpenFeedback).toHaveBeenCalledOnce();
  });

  it("keeps the stable window open on blur and closes through the shared close action", async () => {
    const values = props();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <SettingsContent
          {...values}
          Frame={SettingsWindowFrame}
          settingsOpen={open}
          setSettingsOpen={setOpen}
        />
      );
    }
    render(<Host />);
    fireEvent.blur(window);
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("settles semantic section navigation in the stable window", async () => {
    let navigation;
    function Host() {
      navigation = useUiNavigation();
      const [open, setOpen] = useState(false);
      return (
        <SettingsContent
          {...props()}
          Frame={SettingsWindowFrame}
          settingsOpen={open}
          setSettingsOpen={setOpen}
        />
      );
    }
    render(
      <BlockingEditorsProvider>
        <UiNavigationProvider getRevision={() => 4}>
          <Host />
        </UiNavigationProvider>
      </BlockingEditorsProvider>
    );
    let pending;
    await act(async () => {
      pending = navigation.showSettings({
        section: "analysis",
        expectedRevision: 4,
        expectedUiGeneration: navigation.inspectUi().uiGeneration,
      });
      await Promise.resolve();
    });
    await pending;
    expect(document.activeElement?.getAttribute("data-settings-section-id")).toBe("analysis");
  });
  it("keeps a requested section in view while the content settles, until the user scrolls", async () => {
    const observers = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback) {
          this.callback = callback;
          this.disconnected = false;
          observers.push(this);
        }
        observe() {}
        disconnect() {
          this.disconnected = true;
        }
      }
    );
    const scrolls = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrolls;
    let navigation;
    function Host() {
      navigation = useUiNavigation();
      const [open, setOpen] = useState(false);
      return (
        <SettingsContent
          {...props()}
          Frame={SettingsWindowFrame}
          settingsOpen={open}
          setSettingsOpen={setOpen}
        />
      );
    }
    render(
      <BlockingEditorsProvider>
        <UiNavigationProvider getRevision={() => 4}>
          <Host />
        </UiNavigationProvider>
      </BlockingEditorsProvider>
    );
    let pending;
    await act(async () => {
      pending = navigation.showSettings({
        section: "about",
        expectedRevision: 4,
        expectedUiGeneration: navigation.inspectUi().uiGeneration,
      });
      await Promise.resolve();
    });
    await pending;
    const about = document.querySelector('[data-settings-section-id="about"]');
    expect(scrolls.mock.contexts.at(-1)).toBe(about);
    const count = scrolls.mock.calls.length;
    // Content above the section changes height after opening (an asynchronous status row).
    act(() => observers.filter((o) => !o.disconnected).forEach((o) => o.callback([])));
    expect(scrolls.mock.calls.length).toBe(count + 1);
    expect(scrolls.mock.contexts.at(-1)).toBe(about);
    fireEvent.wheel(document.querySelector("[data-settings-scroll]"));
    act(() => observers.filter((o) => !o.disconnected).forEach((o) => o.callback([])));
    expect(scrolls.mock.calls.length).toBe(count + 1);
    expect(observers.every((observer) => observer.disconnected)).toBe(true);
  });
});
