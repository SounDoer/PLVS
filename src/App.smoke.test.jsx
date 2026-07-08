/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

// Default browser mode (isTauri -> false) keeps the mount deterministic; individual
// tests flip it to exercise the Tauri capture path against the mocked IPC surface.
vi.mock("./ipc/env.js", () => ({ isTauri: vi.fn(() => false) }));

// IPC surface: everything resolves benignly. Add exports here if the mount throws
// "No export named X" — keep resolutions inert, do not weaken assertions instead.
vi.mock("./ipc/commands.js", () => ({
  listAudioDevices: vi.fn().mockResolvedValue([]),
  previewAudioDevice: vi.fn().mockResolvedValue({ sampleRateHz: 48000, label: "Mock" }),
  startAudioCapture: vi.fn().mockResolvedValue(undefined),
  stopAudioCapture: vi.fn().mockResolvedValue(undefined),
  setLoudnessWeights: vi.fn().mockResolvedValue(undefined),
  setDialogueGating: vi.fn().mockResolvedValue(undefined),
  setDialogueVadEngine: vi.fn().mockResolvedValue(undefined),
  ackFrames: vi.fn().mockResolvedValue(undefined),
  setAnalysisRequests: vi.fn().mockResolvedValue(undefined),
  startFileAnalysis: vi.fn().mockResolvedValue(undefined),
  stopFileAnalysis: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  cleanup();
  localStorage.clear();
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
  window.ResizeObserver =
    window.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

describe("App smoke", () => {
  it("mounts the full app shell", async () => {
    const { default: App } = await import("./App.jsx");
    render(<App />);
    // Transport spine: if the derived Ready status and START button render, the
    // whole provider/workspace/panel tree mounted without throwing.
    expect(await screen.findByText("Ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: /start/i })).toBeTruthy();
  });

  it("START click settles back to Ready without crashing (browser branch)", async () => {
    const { default: App } = await import("./App.jsx");
    render(<App />);
    const start = await screen.findByRole("button", { name: /^start$/i });
    fireEvent.click(start);
    // Click sets running=true; useAudioEngine's browser branch synchronously flips
    // it back off inside the engine effect. The transport must settle on START/Ready
    // — a wedged or crashed engine effect leaves STOP/a clock label behind.
    // (A deeper wiring assertion needs the Tauri branch, which would require mocking
    // the whole shell-API surface — deliberately out of scope for this safety net.)
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^start$/i })).toBeTruthy();
      expect(screen.getByText("Ready")).toBeTruthy();
    });
  });
});
