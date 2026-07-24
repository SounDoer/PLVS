/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { AppHeader } from "./AppHeader.jsx";

vi.mock("../workspace/WorkspaceToolbar.jsx", () => ({
  ModulesPopoverContent: () => <div>Mock modules menu</div>,
}));

const NOOP_PRESETS = {
  list: [],
  activeId: null,
  save: () => {},
  apply: () => {},
  update: () => {},
  rename: () => {},
  remove: () => {},
};

function renderHeader(overrides = {}) {
  const props = {
    autoHideControls: false,
    onPointerEnter: vi.fn(),
    onPointerLeave: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
    sourceTransportState: {
      chromeState: "ready",
      sourceLabel: "LIVE",
      statusLabel: "Ready",
      actionLabel: "START",
      actionKind: "start-live",
      primaryActionDisabled: false,
    },
    notice: null,
    sourceMode: "live",
    onSourceModeChange: vi.fn(),
    onSourceTransportAction: vi.fn(),
    onClear: vi.fn(),
    clearDisabled: false,
    isTauriApp: true,
    onOpenFile: vi.fn(),
    audioDevices: [
      { id: "out-1", label: "Speakers (Realtek USB Audio)" },
      { id: "in-1", label: "Microphone (USB Interface)" },
    ],
    audioOutputs: [{ id: "out-1", label: "Speakers (Realtek USB Audio)" }],
    audioInputs: [{ id: "in-1", label: "Microphone (USB Interface)" }],
    safeAudioDeviceId: "default",
    setCaptureDeviceId: vi.fn(),
    holdFocusControls: vi.fn(),
    focusView: { autoHideControls: false, compactPanels: false, borderless: false },
    focusViewActive: false,
    pinned: false,
    setPinned: vi.fn(),
    setAutoHideControls: vi.fn(),
    setCompactPanels: vi.fn(),
    setBorderless: vi.fn(),
    panelOpacity: 100,
    setPanelOpacity: vi.fn(),
    glassEnabled: false,
    setGlassEnabled: vi.fn(),
    presets: NOOP_PRESETS,
    setSettingsOpen: vi.fn(),
    ...overrides,
  };

  return { ...render(<AppHeader {...props} />), props };
}

describe("AppHeader", () => {
  beforeEach(() => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue("Win32");
  });

  it("renders the source transport cluster and toolbar actions", () => {
    renderHeader();

    const sourceButton = screen.getByRole("button", { name: "Source: LIVE" });
    expect(sourceButton).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "START" })).toBeTruthy();

    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Devices" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Modules" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Views" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Presets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Loudness Profile" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("renders an error transport notice with tooltip text", () => {
    renderHeader({
      notice: {
        kind: "error",
        text: "Error: Audio unavailable",
        details: "audio_start: device unavailable",
      },
    });

    const notice = screen.getByText("Error: Audio unavailable");
    expect(notice.title).toBe("audio_start: device unavailable");
    expect(notice.className).toContain("ui-signal-bad");
  });

  it("renders a guard transport notice", () => {
    renderHeader({ notice: { kind: "guard", text: "File analysis already in progress" } });

    expect(screen.getByText("File analysis already in progress")).toBeTruthy();
  });

  it("uses the short Devices copy and formatted device rows", () => {
    renderHeader();

    const devicesButton = screen.getByRole("button", { name: "Devices" });
    const icon = devicesButton.querySelector("svg");
    expect(icon?.classList.contains("size-[length:var(--ui-icon-shell-action)]")).toBe(true);
    expect(icon?.classList.contains("shrink-0")).toBe(true);

    fireEvent.click(devicesButton);

    expect(screen.getByText("Devices")).toBeTruthy();
    expect(screen.queryByText("Audio Device")).toBeNull();
    expect(screen.getByRole("button", { name: "Automatic (default system output)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Speakers (Realtek USB Audio)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Microphone (USB Interface)" })).toBeTruthy();
    expect(screen.getByText("Speakers")).toBeTruthy();
    expect(screen.getByText("Realtek USB Audio")).toBeTruthy();
  });

  it("seats Loudness Profile between Devices and Modules", () => {
    const { container } = renderHeader();
    const buttons = within(container.querySelector("header"))
      .getAllByRole("button")
      .map((button) => button.ariaLabel);

    expect(buttons.indexOf("Devices")).toBeLessThan(buttons.indexOf("Loudness Profile"));
    expect(buttons.indexOf("Loudness Profile")).toBeLessThan(buttons.indexOf("Modules"));
  });

  it("marks the Loudness Profile trigger active only when a profile is selected", () => {
    renderHeader({ loudnessProfile: { active: "off" } });
    expect(
      screen.getByRole("button", { name: "Loudness Profile" }).classList.contains("text-foreground")
    ).toBe(false);

    cleanup();
    renderHeader({ loudnessProfile: { active: "profile:test" } });
    expect(
      screen.getByRole("button", { name: "Loudness Profile" }).classList.contains("text-foreground")
    ).toBe(true);
  });

  it("orders Focus View before Presets and reflects Focus View active state", () => {
    const { container } = renderHeader({ focusViewActive: true });
    const toolbar = container.querySelector("header");
    const buttons = within(toolbar)
      .getAllByRole("button")
      .map((button) => button.ariaLabel);

    expect(buttons.indexOf("Views")).toBeLessThan(buttons.indexOf("Presets"));
    expect(
      screen.getByRole("button", { name: "Views" }).classList.contains("text-foreground")
    ).toBe(true);
  });

  it("renders Modules and Presets popovers from toolbar triggers", () => {
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Modules" }));
    expect(screen.getByText("Modules")).toBeTruthy();
    expect(screen.getByText("Mock modules menu")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    expect(screen.getByText("No presets yet. Save the current view to start.")).toBeTruthy();
  });

  it("gives every toolbar popover the shared adaptive width range", () => {
    const loudnessProfile = {
      active: "off",
      document: null,
      profiles: [],
      draftBlocksLibraryActions: false,
      selectOff: vi.fn(),
      beginCreate: vi.fn(),
    };

    for (const name of ["Devices", "Loudness Profile", "Modules", "Views", "Presets"]) {
      renderHeader({ loudnessProfile });
      fireEvent.click(screen.getByRole("button", { name }));

      const content = document.querySelector('[data-slot="popover-content"]');
      expect(content.className).toContain("w-max");
      expect(content.className).toContain("min-w-40");
      expect(content.className).toContain("max-w-[min(18rem,92vw)]");

      cleanup();
    }
  });

  it("holds auto-hidden controls while toolbar popovers are open", () => {
    const holdFocusControls = vi.fn();
    renderHeader({ autoHideControls: true, holdFocusControls });

    fireEvent.click(screen.getByRole("button", { name: "Modules" }));
    fireEvent.click(screen.getByRole("button", { name: "Views" }));
    fireEvent.click(screen.getByRole("button", { name: "Presets" }));

    expect(holdFocusControls).toHaveBeenCalledWith(true);
    expect(holdFocusControls.mock.calls.filter(([open]) => open === true)).toHaveLength(3);
  });

  it("keeps the Presets toolbar icon in the default muted state", () => {
    renderHeader({ presets: { ...NOOP_PRESETS, activeId: "mix" } });

    expect(
      screen.getByRole("button", { name: "Presets" }).classList.contains("text-foreground")
    ).toBe(false);
  });

  it("moves pin control into the Views popover", () => {
    renderHeader();

    expect(screen.queryByRole("button", { name: /pin/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Views" }));

    expect(screen.getByRole("switch", { name: "Always on Top" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Auto-hide Controls" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Compact Panels" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Hide Chrome" })).toBeTruthy();
  });

  it("uses the Devices slot as Open file in File mode", () => {
    const onOpenFile = vi.fn();
    renderHeader({ sourceMode: "file", onOpenFile });

    expect(screen.queryByRole("button", { name: "Devices" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));

    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });
});
