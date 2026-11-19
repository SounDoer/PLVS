import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisualBookkeeping } from "../bridge/visualBookkeeping.js";
import { DOCK_RECORDING_EXTENT_PX } from "../visualControl.js";
import { visualHandlers } from "./visual.js";

function harness() {
  let revision = 0;
  const state = {
    dock: { edge: "top" },
    visual: {
      platformCapabilities: {
        recording: { available: true, targets: ["main", "dock"], cursorModes: ["none"] },
      },
      getRuntime: () => ({
        windowForm: "dock",
        sourceMode: "live",
        availableScreenshotTargets: ["main"],
        availableAudioSources: ["none"],
      }),
      settle: vi.fn(async () => ({
        revision,
        viewport: { width: 800, height: 50 },
        rect: { x: 0, y: 0, width: 800, height: 50 },
      })),
      startRecording: vi.fn(async () => ({ recordingId: "first", state: "recording" })),
      inspectRecording: vi.fn(async (recordingId) => ({ recordingId, state: "recording" })),
      subscribe: vi.fn(),
      updateRecordingGeometry: vi.fn(async () => {}),
      setRecordingState: vi.fn(),
    },
  };
  const book = createVisualBookkeeping();
  const run = (method, params) =>
    visualHandlers[method].run(
      /** @type {any} */ ({
        requestId: method,
        request: { method, params },
        live: () => state,
        clock: { current: () => revision },
        visual: book,
      })
    );
  return {
    state,
    book,
    bump: () => ++revision,
    start: (kind = "main") => run("visual.recording.start", { target: { kind }, cursor: "none" }),
    inspect: (recordingId) => run("visual.recording.inspect", { recordingId }),
  };
}

describe("Visual recording lifecycle", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps the new indicator and first end revision when an older poll settles late", async () => {
    vi.useFakeTimers();
    const { state, start, inspect, bump, book } = harness();
    const { visual } = state;
    const unsubscribe = vi.fn();
    visual.subscribe.mockReturnValueOnce(unsubscribe);
    /** @type {(recording: { recordingId: string, state: string }) => void} */
    let finishPoll = () => {};
    visual.inspectRecording.mockImplementationOnce(
      () => new Promise((resolve) => (finishPoll = resolve))
    );
    await start();
    await vi.advanceTimersByTimeAsync(250);

    visual.startRecording.mockResolvedValueOnce({ recordingId: "second", state: "recording" });
    await start();
    bump();
    finishPoll({ recordingId: "first", state: "completed" });
    await vi.advanceTimersByTimeAsync(0);

    bump();
    visual.inspectRecording.mockResolvedValueOnce({ recordingId: "first", state: "completed" });
    const response = await inspect("first");
    expect(response.result.recording).toMatchObject({ endedRevision: 1, currentRevision: 2 });
    expect(visual.setRecordingState.mock.calls).toEqual([["recording"], ["recording"]]);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(book.activeRecording.current).toMatchObject({ recordingId: "second" });
  });

  it("retries a temporary inspection error and cleans up exactly once", async () => {
    vi.useFakeTimers();
    const { state, start, inspect, bump, book } = harness();
    const { visual } = state;
    const unsubscribe = vi.fn();
    visual.subscribe.mockReturnValueOnce(unsubscribe);
    visual.inspectRecording
      .mockRejectedValueOnce(new Error("Temporary IPC error"))
      .mockResolvedValue({ recordingId: "first", state: "completed" });
    await start();

    await vi.advanceTimersByTimeAsync(250);
    expect(visual.setRecordingState).toHaveBeenLastCalledWith("recording");
    bump();
    await vi.advanceTimersByTimeAsync(2000);
    expect(visual.inspectRecording).toHaveBeenCalledTimes(2);
    expect(visual.setRecordingState).toHaveBeenLastCalledWith(null);
    expect(book.activeRecording.current).toBeNull();

    bump();
    const response = await inspect("first");
    expect(response.result.recording).toMatchObject({ endedRevision: 1, currentRevision: 2 });
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("includes the toolbar side of the Dock after an edge change with the same viewport", async () => {
    vi.useFakeTimers();
    const { state, start } = harness();
    const { visual } = state;
    await start("dock");
    const geometry = await visual.settle();
    const [, publishGeometry, options] = visual.subscribe.mock.calls[0];

    expect(visual.startRecording).toHaveBeenCalledWith(
      expect.objectContaining({ rect: expect.objectContaining({ y: 0 }) })
    );
    expect(options.followDockEdge).toBe(true);
    publishGeometry(geometry, "bottom");
    expect(visual.updateRecordingGeometry).toHaveBeenLastCalledWith(
      expect.objectContaining({ rect: expect.objectContaining({ y: -DOCK_RECORDING_EXTENT_PX }) })
    );
    state.dock.edge = "bottom";
    publishGeometry(geometry);
    expect(visual.updateRecordingGeometry).toHaveBeenLastCalledWith(
      expect.objectContaining({ rect: expect.objectContaining({ y: -DOCK_RECORDING_EXTENT_PX }) })
    );
  });
});
