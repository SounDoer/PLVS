/** @vitest-environment jsdom */
// Dedicated file, not the main AppSettingsOverlays.test.jsx: that file mocks SettingsPanel at
// module scope for its own tests, which would only prove props reach a fake div here. This file
// renders the real SettingsPanel end to end -- settingsStore -> useSettings -> AppSettingsOverlays
// -> SettingsPanel's actual "Dialogue Detection" select -- so a typo'd prop name anywhere on that
// path fails this test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppSettingsOverlays } from "./AppSettingsOverlays.jsx";
import { useSettings } from "../hooks/useSettings.js";
import { settingsStore } from "../persistence/index.js";

function Harness() {
  const settings = useSettings();
  const channelSettings = {
    channelCount: 2,
    channelLabelTokens: [],
    channelLabelHasOverride: false,
    setChannelLabelToken: vi.fn(),
    resetChannelLabels: vi.fn(),
  };
  const updateControls = {
    updateInfo: null,
    refreshUpdateCheck: vi.fn(),
    installStatus: "idle",
    install: vi.fn(),
    restartToApply: vi.fn(),
    resetInstall: vi.fn(),
  };
  return (
    <>
      {/* useSettings() starts closed; this test-only trigger opens it, standing in for whatever
          toolbar button App.jsx normally wires to setSettingsOpen. */}
      <button type="button" onClick={() => settings.setSettingsOpen(true)}>
        Open settings (test)
      </button>
      <AppSettingsOverlays
        settings={settings}
        channelSettings={channelSettings}
        updateControls={updateControls}
        appVersion="0.0.0"
      />
    </>
  );
}

function renderHarness() {
  const view = render(<Harness />);
  // The panel only renders its rows while open.
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Open settings (test)" }));
  });
  return view;
}

describe("AppSettingsOverlays: Dialogue Detection round trip through the real panel", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    settingsStore.reset();
    localStorage.clear();
  });

  it("reads a stored engine into the select and persists a new choice back to settingsStore", async () => {
    settingsStore.patch({ dialogueVadEngine: "ten" });
    renderHarness();

    await waitFor(() => {
      expect(screen.getByLabelText("Dialogue Detection")).toBeTruthy();
    });
    expect(screen.getByLabelText("Dialogue Detection").textContent).toBe("TEN VAD");

    fireEvent.click(screen.getByLabelText("Dialogue Detection"));
    fireEvent.click(screen.getByText("Silero VAD"));

    await waitFor(() => {
      expect(settingsStore.read().dialogueVadEngine).toBe("silero");
    });
    expect(screen.getByLabelText("Dialogue Detection").textContent).toBe("Silero VAD");
  });
});
