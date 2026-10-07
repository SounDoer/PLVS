/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

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
    surfaceOpacity: 100,
    setSurfaceOpacity: vi.fn(),
    glassEnabled: false,
    setGlassEnabled: vi.fn(),
    presets: NOOP_PRESETS,
    setSettingsOpen: vi.fn(),
    loudnessProfile: undefined,
    loudnessProfileStats: undefined,
    onRefreshSources: undefined,
    showDock: undefined,
    dockEdge: undefined,
    onDockChange: undefined,
    dockDisabled: undefined,
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
    fireEvent.click(sourcesButton);

    expect(screen.getByText("Sources")).toBeTruthy();
    expect(screen.queryByText("Audio Device")).toBeNull();
    expect(screen.getByRole("button", { name: "Automatic" })).toBeTruthy();
    expect(screen.queryByText("(default system output)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Output/ }));
    const speakers = screen.getByRole("button", { name: "Speakers (Realtek USB Audio)" });
    expect(speakers).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Input/ }));
    expect(screen.getByRole("button", { name: "Microphone (USB Interface)" })).toBeTruthy();
    expect(within(speakers).getByText("Speakers")).toBeTruthy();
    expect(within(speakers).getByText("Realtek USB Audio")).toBeTruthy();
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
    const application = screen.getByRole("button", { name: "VLC application audio" });
    expect(within(application).getByText("reference.wav - VLC")).toBeTruthy();
    fireEvent.click(application);
    expect(setCaptureDeviceId).toHaveBeenCalledWith("app-00112233445566778899aabbccddeeff");
  });

  it("starts every source group collapsed and expands them independently", () => {
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
    expect(output.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(applications.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(input);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(output.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(output);
    expect(output.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  it("summarizes the selected application without opening its group", () => {
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

    const applications = screen.getByRole("button", { name: /^Applications/ });
    expect(applications.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("VLC Selected")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "VLC application audio" })).toBeNull();
    fireEvent.click(applications);
    expect(screen.getByRole("button", { name: "VLC application audio" })).toBeTruthy();
  });

  it("keeps the Sources heading and Automatic row outside one bounded scroll area", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));

    const content = document.querySelector('[data-slot="popover-content"]');
    const scrollArea = content.querySelector("[data-source-scroll]");

    expect(scrollArea.contains(screen.getByText("Sources"))).toBe(false);
    expect(scrollArea.contains(screen.getByRole("button", { name: "Automatic" }))).toBe(false);
  });

  it("keeps collapsed source rows in layout so expanding a group cannot change the width", () => {
    renderHeader({
      captureApplications: [
        {
          id: "app-00112233445566778899aabbccddeeff",
          label: "Example Application",
          windowTitle: "A much longer application window title",
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));

    const applications = screen.getByRole("button", { name: /^Applications/ });
    const applicationRows = document.getElementById(applications.getAttribute("aria-controls"));
    expect(applications.getAttribute("aria-expanded")).toBe("false");
    expect(applicationRows.hasAttribute("hidden")).toBe(false);
    expect(applicationRows.getAttribute("aria-hidden")).toBe("true");
    expect(applicationRows.hasAttribute("inert")).toBe(true);

    expect(applicationRows.textContent).toContain("A much longer application window title");

    fireEvent.click(applications);
    expect(applicationRows.hasAttribute("aria-hidden")).toBe(false);
    expect(applicationRows.hasAttribute("inert")).toBe(false);
  });

  it("seats Loudness Profile between Sources and Modules", () => {
    const { container } = renderHeader();
    const buttons = within(container.querySelector("header"))
      .getAllByRole("button")
      .map((button) => button.ariaLabel);

    expect(buttons.indexOf("Sources")).toBeLessThan(buttons.indexOf("Loudness Profile"));
    expect(buttons.indexOf("Loudness Profile")).toBeLessThan(buttons.indexOf("Modules"));
  });

  it("orders Views before Presets without highlighting active configuration", () => {
    const { container } = renderHeader({ focusViewActive: true });
    const toolbar = container.querySelector("header");
    const buttons = within(toolbar)
      .getAllByRole("button")
      .map((button) => button.ariaLabel);

    expect(buttons.indexOf("Views")).toBeLessThan(buttons.indexOf("Presets"));
  });

  it("renders Modules and Presets popovers from toolbar triggers", () => {
    renderHeader();

    fireEvent.click(screen.getByRole("button", { name: "Modules" }));
    expect(screen.getByText("Modules")).toBeTruthy();
    expect(screen.getByText("Mock modules menu")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Presets" }));
    expect(screen.getByPlaceholderText("Name your first preset")).toBeTruthy();
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

      const trigger = button.closest('[data-slot="popover-trigger"]');

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
