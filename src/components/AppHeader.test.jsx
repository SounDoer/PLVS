/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { AppHeader } from "./AppHeader.jsx";

vi.mock("../workspace/WorkspaceToolbar.jsx", () => ({
  ModulesPopoverContent: () => (
    <div>
      <p>Modules</p>
      <p>Mock modules menu</p>
    </div>
  ),
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
    expect(screen.getByRole("button", { name: "Sources" })).toBeTruthy();
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
    expect(notice.className).toContain("ui-signal-bad");
    expect(notice.title).toBe("");
    fireEvent.mouseEnter(notice);
    expect(screen.getByRole("tooltip").textContent).toBe("audio_start: device unavailable");
  });

  it("renders a guard transport notice", () => {
    renderHeader({ notice: { kind: "guard", text: "File analysis already in progress" } });

    expect(screen.getByText("File analysis already in progress")).toBeTruthy();
  });

  it("uses the short Sources copy and formatted device rows", () => {
    renderHeader();

    const sourcesButton = screen.getByRole("button", { name: "Sources" });
    const icon = sourcesButton.querySelector("svg");
    expect(icon?.classList.contains("size-[length:var(--ui-icon-shell-action)]")).toBe(true);
    expect(icon?.classList.contains("shrink-0")).toBe(true);

    fireEvent.click(sourcesButton);

    expect(screen.getByText("Sources")).toBeTruthy();
    expect(screen.queryByText("Audio Device")).toBeNull();
    expect(screen.getByRole("button", { name: "Automatic (default system output)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Speakers (Realtek USB Audio)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Input/ }));
    expect(screen.getByRole("button", { name: "Microphone (USB Interface)" })).toBeTruthy();
    expect(screen.getByText("Speakers")).toBeTruthy();
    expect(screen.getByText("Realtek USB Audio")).toBeTruthy();
  });

  it("lists running applications and refreshes sources when the picker opens", () => {
    const onRefreshSources = vi.fn();
    const setCaptureDeviceId = vi.fn();
    renderHeader({
      captureApplications: [
        {
          id: "app-00112233445566778899aabbccddeeff",
          label: "VLC",
          processId: 4321,
          windowTitle: "reference.wav - VLC",
        },
      ],
      onRefreshSources,
      setCaptureDeviceId,
    });

    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    expect(onRefreshSources).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /^Applications/ }));
    expect(screen.getByText("reference.wav - VLC")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "VLC application audio" }));
    expect(setCaptureDeviceId).toHaveBeenCalledWith("app-00112233445566778899aabbccddeeff");
  });

  it("expands device groups independently and keeps Output open by default", () => {
    renderHeader({
      captureApplications: [
        {
          id: "app-00112233445566778899aabbccddeeff",
          label: "VLC",
          windowTitle: "reference.wav - VLC",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Sources" }));

    const output = screen.getByRole("button", { name: /^Output/ });
    const input = screen.getByRole("button", { name: /^Input/ });
    const applications = screen.getByRole("button", { name: /^Applications/ });
    expect(output.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(applications.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(output.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(output);
    expect(output.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("opens and summarizes the group containing the selected application", () => {
    const applicationId = "app-00112233445566778899aabbccddeeff";
    renderHeader({
      safeAudioDeviceId: applicationId,
      captureApplications: [
        {
          id: applicationId,
          label: "VLC",
          windowTitle: "reference.wav - VLC",
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Sources" }));

    expect(
      screen.getByRole("button", { name: /^Applications/ }).getAttribute("aria-expanded")
    ).toBe("true");
    expect(screen.getByText("VLC Selected")).toBeTruthy();
    expect(screen.getByRole("button", { name: "VLC application audio" })).toBeTruthy();
  });

  it("keeps the Sources heading and Automatic row outside one bounded scroll area", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));

    const content = document.querySelector('[data-slot="popover-content"]');
    const scrollArea = content.querySelector("[data-source-scroll]");
    expect(content.className).toContain("max-h-[var(--radix-popover-content-available-height)]");
    expect(content.className).toContain("overflow-hidden");
    expect(content.className).toContain("w-[min(21rem,92vw)]");
    expect(scrollArea.className).toContain("overflow-y-auto");
    expect(scrollArea.className).toContain("overscroll-contain");
    expect(scrollArea.className).toContain("[scrollbar-gutter:stable]");
    expect(scrollArea.contains(screen.getByText("Sources"))).toBe(false);
    expect(
      scrollArea.contains(screen.getByRole("button", { name: "Automatic (default system output)" }))
    ).toBe(false);
  });

  it("seats Loudness Profile between Sources and Modules", () => {
    const { container } = renderHeader();
    const buttons = within(container.querySelector("header"))
      .getAllByRole("button")
      .map((button) => button.ariaLabel);

    expect(buttons.indexOf("Sources")).toBeLessThan(buttons.indexOf("Loudness Profile"));
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

  it("gives non-device toolbar popovers the shared adaptive width range", () => {
    const loudnessProfile = {
      active: "off",
      document: null,
      profiles: [],
      draftBlocksLibraryActions: false,
      selectOff: vi.fn(),
      beginCreate: vi.fn(),
    };

    for (const name of ["Loudness Profile", "Modules", "Views", "Presets"]) {
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

  it("marks the Presets trigger active only when a preset is applied and unmodified", () => {
    renderHeader({ presets: { ...NOOP_PRESETS, activeId: null } });
    expect(
      screen.getByRole("button", { name: "Presets" }).classList.contains("text-foreground")
    ).toBe(false);

    cleanup();
    renderHeader({ presets: { ...NOOP_PRESETS, activeId: "mix" } });
    expect(
      screen.getByRole("button", { name: "Presets" }).classList.contains("text-foreground")
    ).toBe(true);

    cleanup();
    renderHeader({ presets: { ...NOOP_PRESETS, activeId: "mix", dirty: true } });
    expect(
      screen.getByRole("button", { name: "Presets" }).classList.contains("text-foreground")
    ).toBe(false);
  });

  it("marks every toolbar popover trigger persistently open, not just on hover", () => {
    renderHeader({
      loudnessProfile: {
        active: "off",
        document: null,
        profiles: [],
        draftBlocksLibraryActions: false,
        selectOff: vi.fn(),
        beginCreate: vi.fn(),
      },
    });

    for (const name of ["Sources", "Loudness Profile", "Modules", "Views", "Presets"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("group-data-[state=open]:bg-accent");
      expect(button.className).toContain("group-data-[state=open]:text-accent-foreground");

      const trigger = button.closest('[data-slot="popover-trigger"]');
      expect(trigger.className).toContain("group");
      expect(trigger.getAttribute("data-state")).toBe("closed");

      fireEvent.click(button);
      expect(trigger.getAttribute("data-state")).toBe("open");
    }
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

  it("uses the Sources slot as Open file in File mode", () => {
    const onOpenFile = vi.fn();
    renderHeader({ sourceMode: "file", onOpenFile });

    expect(screen.queryByRole("button", { name: "Sources" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open file" }));

    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });
});
