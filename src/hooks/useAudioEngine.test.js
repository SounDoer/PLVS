/** @vitest-environment jsdom */
import { standIn } from "../testing/standIn.js";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useAudioEngine } from "./useAudioEngine.js";

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));
vi.mock("../lib/platform.js", () => ({ isWindows: () => true }));

const engineEvents = vi.hoisted(() => ({ state: null, backpressure: null }));

vi.mock("../ipc/events.js", () => ({
  onEngineStateChanged: vi.fn(async (handler) => {
    engineEvents.state = handler;
    return () => {};
  }),
  onEngineBackpressure: vi.fn(async (handler) => {
    engineEvents.backpressure = handler;
    return () => {};
  }),
}));

vi.mock("../ipc/commands.js", () => ({
  listAudioDevices: vi.fn(),
  previewAudioDevice: vi.fn(),
  startAudioCapture: vi.fn(),
  stopAudioCapture: vi.fn(),
  setChannelRoles: vi.fn(),
  setDialogueGating: vi.fn(),
  setDialogueVadEngine: vi.fn(),
  ackFrames: vi.fn(),
}));

import {
  listAudioDevices,
  previewAudioDevice,
  startAudioCapture,
  stopAudioCapture,
} from "../ipc/commands.js";

/**
 * @param {{
 *   setAudio: (...args: any[]) => any,
 *   setSelectedOffset: (...args: any[]) => any,
 *   raiseNotice: (...args: any[]) => any,
 *   setShowClock: (...args: any[]) => any,
 *   resetTimer: (...args: any[]) => any,
 *   stopTimer?: (...args: any[]) => any,
 *   halt: (...args: any[]) => any,
 *   recordAudioDrop?: (...args: any[]) => any,
 *   histMaxSamples?: number,
 *   visualMaxSamples?: number,
 *   selectedOffset?: number,
 *   [key: string]: any,
 * }} options
 */
function useHarness({
  setAudio,
  setSelectedOffset,
  raiseNotice,
  setShowClock,
  resetTimer,
  stopTimer,
  halt,
  recordAudioDrop,
  histMaxSamples = 10,
  visualMaxSamples = 10,
  selectedOffset = -1,
  ...props
}) {
  const audioRef = useRef(null);
  const frameRef = useRef(0);
  const selectedOffsetRef = useRef(selectedOffset);
  const latestAudioRef = useRef({
    peakDb: [],
    rmsDb: [],
    samplePeakMaxL: -Infinity,
    samplePeakMaxR: -Infinity,
  });
  const channelRolesRef = useRef(null);
  const dialogueGatingRef = useRef(false);
  const dialogueVadEngineRef = useRef("silero");
  const display = {
    frameRef,
    selectedOffsetRef,
    latestAudioRef,
    setAudio,
    setSelectedOffset,
    raiseNotice,
    setShowClock,
    clock: { resetTimer, stopTimer },
  };

  useAudioEngine({
    captureDeviceId: "default",
    histMaxSamples,
    visualMaxSamples,
    audioRef,
    channelRolesRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
    // the engine also reads lifecycle and the mark* callbacks; this harness leaves them out
    transport: standIn({ running: true, halt, recordAudioDrop }),
    display,
    intake: props.intake,
    defaultSampleRateRef: props.defaultSampleRateRef,
    ...props,
  });

  return { audioRef, frameRef, latestAudioRef, selectedOffsetRef };
}

describe("useAudioEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAudioDevices).mockResolvedValue([
      {
        id: "lb-main",
        label: "Speakers",
        isSystemOutputMonitor: true,
        defaultSampleRate: 48000,
        channels: 2,
      },
    ]);
    vi.mocked(previewAudioDevice).mockResolvedValue({
      label: "Speakers",
      sampleRateHz: 48000,
      channels: 2,
    });
    vi.mocked(startAudioCapture).mockResolvedValue(undefined);
    vi.mocked(stopAudioCapture).mockResolvedValue(undefined);
  });

  it("reports Automatic as the started Source instead of a fallback device row", async () => {
    vi.mocked(listAudioDevices).mockResolvedValue([
      { id: "lb-other", label: "BlackHole 2ch", isSystemOutputMonitor: true, channels: 2 },
      { id: "lb-main", label: "Speakers", isSystemOutputMonitor: true, channels: 2 },
    ]);
    const transport = {
      running: true,
      lifecycle: "running",
      halt: vi.fn(),
      markStarted: vi.fn(),
      markStopped: vi.fn(),
      markStopFailed: vi.fn(),
    };
    renderHook(() =>
      useHarness({
        captureDeviceId: "default",
        intake: { reset: vi.fn() },
        setAudio: vi.fn(),
        raiseNotice: vi.fn(),
        halt: transport.halt,
        transport,
        setSelectedOffset: vi.fn(),
        resetTimer: vi.fn(),
        setShowClock: vi.fn(),
      })
    );

    await waitFor(() => expect(transport.markStarted).toHaveBeenCalledOnce());
    expect(startAudioCapture).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: "default" })
    );
    expect(transport.markStarted).toHaveBeenCalledWith({ resolvedDeviceId: "default" });
  });

  it("starts process loopback for a stable application selection", async () => {
    const applicationId = "app-00112233445566778899aabbccddeeff";
    renderHook(() =>
      useHarness({
        captureDeviceId: applicationId,
        intake: { reset: vi.fn() },
        setAudio: vi.fn(),
        raiseNotice: vi.fn(),
        halt: vi.fn(),
        setSelectedOffset: vi.fn(),
        resetTimer: vi.fn(),
        setShowClock: vi.fn(),
      })
    );

    await waitFor(() =>
      expect(startAudioCapture).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "default", applicationId })
      )
    );
    expect(previewAudioDevice).toHaveBeenCalledWith("default");
  });

  it("clears local meter state when capture format changes during a running session", async () => {
    const props = {
      captureFormatSignature: "2:48000",
      intake: { reset: vi.fn(), pushFrame: vi.fn() },
      setAudio: vi.fn(),
      raiseNotice: vi.fn(),
      halt: vi.fn(),
      setSelectedOffset: vi.fn(),
      resetTimer: vi.fn(),
      setShowClock: vi.fn(),
    };

    const { result, rerender } = renderHook((p) => useHarness(p), {
      initialProps: props,
    });
    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(1));

    result.current.frameRef.current = 27;
    vi.clearAllMocks();

    rerender({ ...props, captureFormatSignature: "6:48000" });

    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(1));
    expect(stopAudioCapture).toHaveBeenCalledTimes(1);
    expect(props.intake.reset).toHaveBeenCalledTimes(1);
    expect(result.current.frameRef.current).toBe(0);
    expect(props.setSelectedOffset).toHaveBeenCalledWith(-1);
    expect(props.resetTimer).toHaveBeenCalledWith({ restart: true });
    expect(props.setShowClock).toHaveBeenCalledWith(true);
    expect(props.setAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        peakDb: [],
        momentary: -Infinity,
        shortTerm: -Infinity,
        correlation: -Infinity,
      })
    );
  });

  it("updates frontend history capacity without restarting a running measurement", async () => {
    const props = {
      captureFormatSignature: "2:48000",
      histMaxSamples: 10,
      visualMaxSamples: 10,
      intake: { reset: vi.fn() },
      setAudio: vi.fn(),
      raiseNotice: vi.fn(),
      halt: vi.fn(),
      setSelectedOffset: vi.fn(),
      resetTimer: vi.fn(),
      setShowClock: vi.fn(),
    };

    const { result, rerender } = renderHook((p) => useHarness(p), {
      initialProps: props,
    });
    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(1));

    result.current.frameRef.current = 12;
    vi.clearAllMocks();

    rerender({ ...props, histMaxSamples: 20, visualMaxSamples: 20 });

    await act(async () => {});
    expect(startAudioCapture).not.toHaveBeenCalled();
    expect(stopAudioCapture).not.toHaveBeenCalled();
    expect(props.intake.reset).not.toHaveBeenCalled();
    expect(result.current.frameRef.current).toBe(12);
    expect(props.setSelectedOffset).not.toHaveBeenCalled();
    expect(props.resetTimer).not.toHaveBeenCalled();
    expect(props.setShowClock).not.toHaveBeenCalled();
  });

  it("raises a transport notice when native capture cannot start", async () => {
    vi.mocked(listAudioDevices).mockRejectedValue(new Error("Audio unavailable"));
    const props = {
      intake: { reset: vi.fn() },
      setAudio: vi.fn(),
      raiseNotice: vi.fn(),
      halt: vi.fn(),
      setSelectedOffset: vi.fn(),
      resetTimer: vi.fn(),
      setShowClock: vi.fn(),
    };

    renderHook((p) => useHarness(p), {
      initialProps: props,
    });

    await waitFor(() =>
      expect(props.raiseNotice).toHaveBeenCalledWith(
        "error",
        "Error: Audio unavailable",
        undefined,
        { requiresAttention: true, helpTopic: "audio-capture" }
      )
    );
  });

  it.each([
    [undefined, "audio-capture"],
    ["systemSpeakerLayout", "system-output-speaker-layout"],
    ["outputInUse", "output-in-use"],
  ])("halts LIVE and chooses the help topic for %s", async (failureReason, helpTopic) => {
    const props = {
      intake: { reset: vi.fn() },
      setAudio: vi.fn(),
      raiseNotice: vi.fn(),
      halt: vi.fn(),
      setSelectedOffset: vi.fn(),
      resetTimer: vi.fn(),
      stopTimer: vi.fn(),
      setShowClock: vi.fn(),
    };
    renderHook((p) => useHarness(p), { initialProps: props });
    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(1));

    act(() => engineEvents.state({ state: "running" }));
    act(() => engineEvents.state({ state: "stopped" }));
    expect(props.halt).not.toHaveBeenCalled();

    const reason = "Capture stopped: no audio received for 5 s.";
    act(() => engineEvents.state({ state: "error", error: reason, reason: failureReason }));
    expect(props.halt).toHaveBeenCalledWith(expect.objectContaining({ message: reason }));
    expect(props.stopTimer).toHaveBeenCalled();
    expect(props.setSelectedOffset).toHaveBeenCalledWith(-1);
    expect(props.raiseNotice).toHaveBeenCalledWith("error", `Error: ${reason}`, undefined, {
      requiresAttention: true,
      helpTopic,
    });
  });

  it.each([
    ["default", "deviceDisconnected"],
    ["lb-main", "deviceInvalidated"],
  ])("rebuilds %s once on %s and clears the Live measurement", async (deviceId, reason) => {
    const props = {
      captureDeviceId: deviceId,
      intake: { reset: vi.fn(), pushFrame: vi.fn() },
      setAudio: vi.fn(),
      raiseNotice: vi.fn(),
      halt: vi.fn(),
      setSelectedOffset: vi.fn(),
      resetTimer: vi.fn(),
      stopTimer: vi.fn(),
      setShowClock: vi.fn(),
    };
    const { result } = renderHook((p) => useHarness(p), { initialProps: props });
    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());
    result.current.frameRef.current = 41;
    vi.clearAllMocks();

    act(() =>
      engineEvents.state({
        state: "error",
        error: "Capture stopped: the audio device is no longer available.",
        reason,
      })
    );

    await waitFor(() =>
      expect(startAudioCapture).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ deviceId })
      )
    );
    expect(stopAudioCapture).toHaveBeenCalledOnce();
    expect(props.halt).not.toHaveBeenCalled();
    expect(props.intake.reset).toHaveBeenCalledOnce();
    expect(result.current.frameRef.current).toBe(0);
    expect(props.resetTimer).toHaveBeenCalledWith({ restart: true });

    const recoveredFrame = vi.mocked(startAudioCapture).mock.calls[0][0].onFrame;
    act(() => recoveredFrame({ seq: 0, peakDb: [-12], rmsDb: [-24] }));
    expect(props.raiseNotice).toHaveBeenCalledWith(
      "info",
      "Audio configuration changed — measurement restarted"
    );
  });

  it.each(["native event", "inventory change", "native enumeration", "recovery enumeration"])(
    "halts an exact capture after a %s reports that its source disconnected",
    async (signal) => {
      const props = {
        captureDeviceId: "lb-main",
        captureFormatSignature: "2:48000",
        intake: { reset: vi.fn() },
        setAudio: vi.fn(),
        raiseNotice: vi.fn(),
        halt: vi.fn(),
        setSelectedOffset: vi.fn(),
        resetTimer: vi.fn(),
        stopTimer: vi.fn(),
        setShowClock: vi.fn(),
      };
      const { rerender } = renderHook((current) => useHarness(current), { initialProps: props });
      await waitFor(() =>
        expect(startAudioCapture).toHaveBeenCalledWith(
          expect.objectContaining({ deviceId: "lb-main" })
        )
      );
      if (signal === "inventory change") {
        // The device may already be back by the time the engine could enumerate it again.
        rerender({ ...props, captureDeviceUnavailable: true, captureFormatSignature: "" });
      } else if (signal === "native enumeration") {
        vi.mocked(listAudioDevices).mockResolvedValue([{ id: "lb-other" }]);
        rerender({ ...props, captureFormatSignature: "" });
      } else if (signal === "recovery enumeration") {
        vi.mocked(listAudioDevices).mockResolvedValue([{ id: "lb-other" }]);
        act(() => engineEvents.state({ state: "error", reason: "deviceInvalidated" }));
      } else {
        act(() => engineEvents.state({ state: "error", reason: "deviceDisconnected" }));
      }

      await waitFor(() =>
        expect(props.halt).toHaveBeenCalledExactlyOnceWith(new Error("Source Disconnected"))
      );
      expect(props.stopTimer).toHaveBeenCalledOnce();
      expect(props.raiseNotice).toHaveBeenCalledExactlyOnceWith(
        "warning",
        "Source Disconnected",
        "Reconnect the device or choose another in Sources, then select Start.",
        { requiresAttention: true, helpTopic: "audio-capture" }
      );
      expect(startAudioCapture).toHaveBeenCalledOnce();
      expect(previewAudioDevice).not.toHaveBeenCalled();
    }
  );

  it.each([
    "native event",
    "inventory change",
    "missing input",
    "open failure",
    "repeated open failure",
    "source change",
  ])(
    "recovers only the selected Windows input after %s, within the retry budget",
    async (scenario) => {
      const input = { id: "cap-loopback", label: "Loopback 1/2", defaultSampleRate: 48000 };
      const otherInput = { id: "cap-other", label: "Loopback 3/4", defaultSampleRate: 48000 };
      vi.mocked(listAudioDevices).mockResolvedValue([input, otherInput]);
      const props = {
        captureDeviceId: input.id,
        captureFormatSignature: "2:48000",
        intake: { reset: vi.fn(), pushFrame: vi.fn() },
        setAudio: vi.fn(),
        raiseNotice: vi.fn(),
        halt: vi.fn(),
        setSelectedOffset: vi.fn(),
        resetTimer: vi.fn(),
        stopTimer: vi.fn(),
        setShowClock: vi.fn(),
      };
      const { rerender } = renderHook((current) => useHarness(current), { initialProps: props });
      await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());
      vi.mocked(listAudioDevices).mockClear();
      vi.mocked(startAudioCapture).mockClear();
      if (scenario === "repeated open failure") {
        for (let attempt = 0; attempt < 3; attempt++) {
          vi.mocked(startAudioCapture).mockRejectedValueOnce(
            new Error("The input cannot be opened")
          );
        }
      } else if (scenario === "open failure") {
        vi.mocked(startAudioCapture).mockRejectedValueOnce(
          new Error("Input disappeared during open")
        );
      } else {
        vi.mocked(listAudioDevices).mockResolvedValue([otherInput]);
      }
      if (scenario === "inventory change") {
        rerender({ ...props, captureDeviceUnavailable: true, captureFormatSignature: "" });
      } else {
        act(() =>
          engineEvents.state({
            state: "error",
            reason: "inputStreamInvalidated",
            error: "The stream was invalidated",
          })
        );
      }
      await waitFor(() => expect(listAudioDevices).toHaveBeenCalledOnce());

      if (scenario === "missing input") {
        await waitFor(() => expect(props.halt).toHaveBeenCalledOnce(), { timeout: 1800 });
        expect(listAudioDevices).toHaveBeenCalledTimes(3);
        expect(startAudioCapture).not.toHaveBeenCalled();
        expect(props.raiseNotice).toHaveBeenCalledWith(
          "warning",
          "Source Disconnected",
          expect.any(String),
          expect.objectContaining({ helpTopic: "audio-capture" })
        );
        return;
      }

      if (scenario === "repeated open failure") {
        await waitFor(() => expect(props.halt).toHaveBeenCalledOnce(), { timeout: 1800 });
        expect(startAudioCapture).toHaveBeenCalledTimes(3);
        expect(props.stopTimer).toHaveBeenCalledOnce();
        expect(startAudioCapture).toHaveBeenLastCalledWith(
          expect.objectContaining({ deviceId: input.id })
        );
        expect(props.raiseNotice).toHaveBeenCalledWith(
          "error",
          "Error: The input cannot be opened",
          undefined,
          expect.objectContaining({ helpTopic: "audio-capture" })
        );
        return;
      }

      if (scenario === "source change") {
        rerender({ ...props, captureDeviceId: otherInput.id });
        await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());
        expect(startAudioCapture).toHaveBeenCalledWith(
          expect.objectContaining({ deviceId: otherInput.id })
        );
        return;
      }

      vi.mocked(listAudioDevices).mockResolvedValue([input, otherInput]);
      if (scenario === "inventory change") rerender(props);
      const expectedStarts = scenario === "open failure" ? 2 : 1;
      await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(expectedStarts));
      expect(startAudioCapture).toHaveBeenLastCalledWith(
        expect.objectContaining({ deviceId: input.id, continueSession: false })
      );
      const recoveredFrame = vi.mocked(startAudioCapture).mock.lastCall[0].onFrame;
      act(() => recoveredFrame({ seq: 0, peakDb: [-12], rmsDb: [-24] }));
      expect(props.halt).not.toHaveBeenCalled();
      expect(props.raiseNotice).toHaveBeenCalledWith(
        "info",
        "Audio Capture Recovered",
        "Capture resumed on the same input. A fresh measurement started."
      );
    }
  );

  it.each([
    "recovers",
    "missing input",
    "open failed",
    "backend failed",
    "stalled again",
    "output",
  ])("handles a timeout-only stall when the source %s", async (scenario) => {
    const input = { id: "cap-loopback", defaultSampleRate: 48000, channels: 2 };
    if (scenario !== "output") vi.mocked(listAudioDevices).mockResolvedValue([input]);
    const measurementOwner = {
      beginSession: vi.fn(),
      commitSession: vi.fn(),
      capture: vi.fn(),
    };
    const props = {
      captureDeviceId: scenario === "output" ? "lb-main" : input.id,
      measurementOwner,
      intake: { reset: vi.fn(), pushFrame: vi.fn() },
      setAudio: vi.fn(),
      raiseNotice: vi.fn(),
      halt: vi.fn(),
      setSelectedOffset: vi.fn(),
      resetTimer: vi.fn(),
      stopTimer: vi.fn(),
      setShowClock: vi.fn(),
    };
    renderHook(() => useHarness(props));
    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());
    const timeout = {
      state: "error",
      reason: "inputCallbackStalled",
      error: "Capture stopped: no audio received for 5 s.",
    };
    if (scenario === "missing input")
      vi.mocked(listAudioDevices).mockResolvedValue([{ ...input, id: "cap-other" }]);
    if (scenario === "open failed")
      vi.mocked(startAudioCapture).mockRejectedValueOnce(new Error("Could not reopen input"));
    act(() => engineEvents.state(timeout));

    if (scenario === "missing input" || scenario === "output") {
      await waitFor(() => expect(props.halt).toHaveBeenCalledOnce());
      expect(props.halt).toHaveBeenCalledWith(
        new Error(scenario === "missing input" ? "Source Disconnected" : timeout.error)
      );
      expect(startAudioCapture).toHaveBeenCalledOnce();
      expect(props.intake.reset).not.toHaveBeenCalled();
      return;
    }

    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(2));
    expect(stopAudioCapture).toHaveBeenCalledOnce();
    expect(startAudioCapture).toHaveBeenLastCalledWith(
      expect.objectContaining({ deviceId: input.id, continueSession: false })
    );
    expect(props.intake.reset).not.toHaveBeenCalled();
    expect(measurementOwner.commitSession).toHaveBeenCalledOnce();
    expect(props.raiseNotice).not.toHaveBeenCalledWith(
      "info",
      expect.anything(),
      expect.anything()
    );

    const { onFrame } = vi.mocked(startAudioCapture).mock.lastCall[0];
    if (scenario === "recovers") {
      act(() => onFrame({ seq: 0, peakDb: [-12], rmsDb: [-24] }));
      expect(props.halt).not.toHaveBeenCalled();
      expect(props.intake.reset).toHaveBeenCalledOnce();
      expect(measurementOwner.commitSession).toHaveBeenCalledTimes(2);
      expect(props.raiseNotice).toHaveBeenCalledWith(
        "info",
        "Audio Capture Recovered",
        "Capture resumed on the same input. A fresh measurement started."
      );
      return;
    }
    if (scenario === "stalled again") act(() => engineEvents.state(timeout));
    if (scenario === "backend failed") {
      act(() =>
        engineEvents.state({
          state: "error",
          reason: "inputStreamInvalidated",
          error: "Replacement stream invalidated",
        })
      );
    }
    await waitFor(() => expect(props.halt).toHaveBeenCalledOnce());
    expect(startAudioCapture).toHaveBeenCalledTimes(2);
    expect(props.intake.reset).not.toHaveBeenCalled();
    expect(measurementOwner.commitSession).toHaveBeenCalledOnce();
    expect(props.stopTimer).toHaveBeenCalledOnce();
    expect(props.raiseNotice).toHaveBeenLastCalledWith(
      "error",
      expect.stringMatching(/^Error:/),
      undefined,
      expect.objectContaining({ helpTopic: "audio-capture" })
    );
  });

  it.each(["exhausted", "cancelled"])(
    "bounds rapid invalidation retries when %s",
    async (ending) => {
      const props = {
        captureDeviceId: "lb-main",
        intake: { reset: vi.fn(), pushFrame: vi.fn() },
        setAudio: vi.fn(),
        raiseNotice: vi.fn(),
        halt: vi.fn(),
        setSelectedOffset: vi.fn(),
        resetTimer: vi.fn(),
        stopTimer: vi.fn(),
        setShowClock: vi.fn(),
      };
      const { unmount } = renderHook((p) => useHarness(p), { initialProps: props });
      await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());
      vi.clearAllMocks();

      const invalidate = () =>
        engineEvents.state({
          state: "error",
          error: "stream invalidated",
          reason: "deviceInvalidated",
        });
      act(invalidate);
      await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());
      const recoveredFrame = vi.mocked(startAudioCapture).mock.calls[0][0].onFrame;
      act(() => recoveredFrame({ seq: 0, peakDb: [-12], rmsDb: [-24] }));

      act(() => {
        invalidate();
        invalidate();
      });
      expect(props.halt).not.toHaveBeenCalled();
      expect(startAudioCapture).toHaveBeenCalledOnce();
      await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(2));

      act(invalidate);
      expect(startAudioCapture).toHaveBeenCalledTimes(2);
      if (ending === "cancelled") {
        unmount();
        await act(() => new Promise((resolve) => setTimeout(resolve, 650)));
        expect(startAudioCapture).toHaveBeenCalledTimes(2);
        expect(props.halt).not.toHaveBeenCalled();
        return;
      }
      await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(3));
      expect(startAudioCapture).toHaveBeenLastCalledWith(
        expect.objectContaining({ deviceId: "lb-main" })
      );
      expect(props.halt).not.toHaveBeenCalled();

      act(invalidate);
      expect(props.halt).toHaveBeenCalledWith(
        expect.objectContaining({ message: "stream invalidated" })
      );
      expect(startAudioCapture).toHaveBeenCalledTimes(3);
      expect(props.raiseNotice).toHaveBeenCalledWith(
        "error",
        "Error: stream invalidated",
        undefined,
        { requiresAttention: true, helpTopic: "audio-capture" }
      );
    }
  );

  it("records audio the engine dropped before analysis", async () => {
    const props = {
      intake: { reset: vi.fn() },
      setAudio: vi.fn(),
      raiseNotice: vi.fn(),
      halt: vi.fn(),
      recordAudioDrop: vi.fn(),
      setSelectedOffset: vi.fn(),
      resetTimer: vi.fn(),
      setShowClock: vi.fn(),
    };
    renderHook((p) => useHarness(p), { initialProps: props });
    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(1));

    act(() => engineEvents.backpressure({ droppedChunks: 35 }));
    expect(props.recordAudioDrop).toHaveBeenCalledWith(35);
  });

  it("commits a LIVE measurement session only after native start succeeds", async () => {
    const measurementOwner = {
      beginSession: vi.fn(),
      commitSession: vi.fn(),
      abortSession: vi.fn(),
      capture: vi.fn(),
    };
    const props = {
      measurementOwner,
      intake: { reset: vi.fn(), pushFrame: vi.fn() },
      setAudio: vi.fn(),
      raiseNotice: vi.fn(),
      halt: vi.fn(),
      setSelectedOffset: vi.fn(),
      resetTimer: vi.fn(),
      setShowClock: vi.fn(),
    };
    renderHook((p) => useHarness(p), { initialProps: props });
    await waitFor(() => expect(measurementOwner.commitSession).toHaveBeenCalledOnce());
    expect(measurementOwner.beginSession).toHaveBeenCalledBefore(measurementOwner.commitSession);
    expect(measurementOwner.abortSession).not.toHaveBeenCalled();

    const onFrame = vi.mocked(startAudioCapture).mock.calls[0][0].onFrame;
    act(() => onFrame({ seq: 1, peakDb: [-4], rmsDb: [-16] }));
    expect(measurementOwner.capture).toHaveBeenCalledWith(
      expect.objectContaining({ seq: 1 }),
      expect.objectContaining({ peakDb: [-4], rmsDb: [-16] }),
      { dialogueActive: false }
    );
  });

  it("aborts a pending LIVE measurement session when native start fails", async () => {
    vi.mocked(startAudioCapture).mockRejectedValueOnce(new Error("start failed"));
    const measurementOwner = {
      beginSession: vi.fn(),
      commitSession: vi.fn(),
      abortSession: vi.fn(),
      capture: vi.fn(),
    };
    renderHook(() =>
      useHarness({
        measurementOwner,
        intake: { reset: vi.fn(), pushFrame: vi.fn() },
        setAudio: vi.fn(),
        raiseNotice: vi.fn(),
        halt: vi.fn(),
        setSelectedOffset: vi.fn(),
        resetTimer: vi.fn(),
        setShowClock: vi.fn(),
      })
    );
    await waitFor(() => expect(measurementOwner.abortSession).toHaveBeenCalledOnce());
    expect(measurementOwner.commitSession).not.toHaveBeenCalled();
  });

  it("awaits native shutdown before starting the newly selected running device", async () => {
    let releaseStop;
    vi.mocked(stopAudioCapture).mockReturnValueOnce(
      new Promise((resolve) => {
        releaseStop = resolve;
      })
    );
    const transport = {
      running: true,
      lifecycle: "running",
      halt: vi.fn(),
      markStarted: vi.fn(),
      markStopped: vi.fn(),
      markStopFailed: vi.fn(),
    };
    const props = {
      captureDeviceId: "default",
      captureFormatSignature: "2:48000",
      intake: { reset: vi.fn() },
      setAudio: vi.fn(),
      raiseNotice: vi.fn(),
      halt: transport.halt,
      transport,
      setSelectedOffset: vi.fn(),
      resetTimer: vi.fn(),
      setShowClock: vi.fn(),
    };
    const { rerender } = renderHook((p) => useHarness(p), { initialProps: props });
    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());
    vi.clearAllMocks();

    rerender({ ...props, captureDeviceId: "lb-main" });
    await waitFor(() => expect(stopAudioCapture).toHaveBeenCalledOnce());
    expect(startAudioCapture).not.toHaveBeenCalled();
    await act(async () => releaseStop());
    await waitFor(() =>
      expect(startAudioCapture).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: "lb-main" })
      )
    );
    expect(props.intake.reset).toHaveBeenCalledOnce();
    expect(transport.markStarted).toHaveBeenCalledWith({ resolvedDeviceId: "lb-main" });
  });

  it("waits for a pending native start and its stop before confirming Stop", async () => {
    let releaseStart;
    let releaseStop;
    vi.mocked(startAudioCapture).mockReturnValueOnce(
      new Promise((resolve) => {
        releaseStart = resolve;
      })
    );
    vi.mocked(stopAudioCapture).mockReturnValueOnce(
      new Promise((resolve) => {
        releaseStop = resolve;
      })
    );
    const transport = {
      running: true,
      lifecycle: "starting",
      halt: vi.fn(),
      markStarted: vi.fn(),
      markStopped: vi.fn(),
      markStopFailed: vi.fn(),
    };
    const props = {
      intake: { reset: vi.fn() },
      setAudio: vi.fn(),
      raiseNotice: vi.fn(),
      halt: transport.halt,
      setSelectedOffset: vi.fn(),
      resetTimer: vi.fn(),
      setShowClock: vi.fn(),
      transport,
    };
    const { rerender } = renderHook((p) => useHarness(p), { initialProps: props });
    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());
    rerender({ ...props, transport: { ...transport, running: false, lifecycle: "stopping" } });
    expect(stopAudioCapture).not.toHaveBeenCalled();
    expect(transport.markStopped).not.toHaveBeenCalled();
    await act(async () => releaseStart());
    expect(stopAudioCapture).toHaveBeenCalledOnce();
    expect(transport.markStopped).not.toHaveBeenCalled();
    await act(async () => releaseStop());
    expect(transport.markStopped).toHaveBeenCalledOnce();
    expect(transport.markStarted).not.toHaveBeenCalled();
  });

  describe("Stop and Start of the same Source", () => {
    const transportFor = (running, lifecycle = running ? "running" : "stopped") => ({
      running,
      lifecycle,
      halt: vi.fn(),
      markStarted: vi.fn(),
      markStopped: vi.fn(),
      markStopFailed: vi.fn(),
    });
    const baseProps = (continuationRef) => ({
      continuationRef,
      captureDeviceId: "lb-main",
      captureFormatSignature: "2:48000",
      intake: { reset: vi.fn() },
      setAudio: vi.fn(),
      raiseNotice: vi.fn(),
      halt: vi.fn(),
      setSelectedOffset: vi.fn(),
      resetTimer: vi.fn(),
      setShowClock: vi.fn(),
      transport: transportFor(true),
    });

    async function runThenStop(props, stoppedLifecycle = "stopped") {
      const view = renderHook((p) => useHarness(p), { initialProps: props });
      await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());
      expect(startAudioCapture).toHaveBeenLastCalledWith(
        expect.objectContaining({ continueSession: false })
      );
      view.rerender({ ...props, transport: transportFor(false, stoppedLifecycle) });
      await waitFor(() => expect(props.continuationRef.current).not.toBeNull());
      return view;
    }

    it("continues the measurement and its history", async () => {
      const props = baseProps({ current: null });
      const { rerender } = await runThenStop(props);
      expect(props.continuationRef.current).toEqual({
        deviceId: "lb-main",
        format: "2:48000",
        continuable: true,
      });

      rerender({ ...props, transport: transportFor(true) });
      await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(2));
      expect(startAudioCapture).toHaveBeenLastCalledWith(
        expect.objectContaining({ deviceId: "lb-main", continueSession: true })
      );
      expect(props.intake.reset).not.toHaveBeenCalled();
      expect(props.continuationRef.current).toBeNull();
    });

    it("starts fresh, history included, when the Source changed while stopped", async () => {
      vi.mocked(listAudioDevices).mockResolvedValue([
        { id: "lb-main", label: "Speakers", isSystemOutputMonitor: true, channels: 2 },
        { id: "lb-other", label: "Headphones", isSystemOutputMonitor: true, channels: 2 },
      ]);
      const props = baseProps({ current: null });
      const { rerender } = await runThenStop(props);

      rerender({ ...props, captureDeviceId: "lb-other", transport: transportFor(true) });
      await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(2));
      expect(startAudioCapture).toHaveBeenLastCalledWith(
        expect.objectContaining({ deviceId: "lb-other", continueSession: false })
      );
      expect(props.intake.reset).toHaveBeenCalledOnce();
    });

    it("starts fresh after a failure ends the session", async () => {
      const props = baseProps({ current: null });
      const { rerender } = await runThenStop(props, "error");
      expect(props.continuationRef.current?.continuable).toBe(false);

      rerender({ ...props, transport: transportFor(true) });
      await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(2));
      expect(startAudioCapture).toHaveBeenLastCalledWith(
        expect.objectContaining({ continueSession: false })
      );
      expect(props.intake.reset).toHaveBeenCalledOnce();
    });

    it("starts fresh after a Clear while stopped discarded the session", async () => {
      const props = baseProps({ current: null });
      const { rerender } = await runThenStop(props);
      props.continuationRef.current = null;

      rerender({ ...props, transport: transportFor(true) });
      await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(2));
      expect(startAudioCapture).toHaveBeenLastCalledWith(
        expect.objectContaining({ continueSession: false })
      );
    });
  });

  it("does not start capture while Live is stopped", async () => {
    renderHook(() =>
      useHarness({
        transport: {
          running: false,
          lifecycle: "stopped",
          halt: vi.fn(),
          markStarted: vi.fn(),
          markStopped: vi.fn(),
          markStopFailed: vi.fn(),
        },
        intake: { reset: vi.fn() },
        setAudio: vi.fn(),
        raiseNotice: vi.fn(),
        halt: vi.fn(),
        setSelectedOffset: vi.fn(),
        resetTimer: vi.fn(),
        setShowClock: vi.fn(),
      })
    );
    await Promise.resolve();
    expect(startAudioCapture).not.toHaveBeenCalled();
  });

  it("keeps reducing active live frames without publishing while snapshot is open", async () => {
    const setAudio = vi.fn();
    const intake = { reset: vi.fn(), pushFrame: vi.fn() };
    const { result } = renderHook(() =>
      useHarness({
        selectedOffset: 0,
        intake,
        setAudio,
        raiseNotice: vi.fn(),
        halt: vi.fn(),
        setSelectedOffset: vi.fn(),
        resetTimer: vi.fn(),
        setShowClock: vi.fn(),
      })
    );
    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());

    const onFrame = vi.mocked(startAudioCapture).mock.calls[0][0].onFrame;
    onFrame({ peakDb: [-6], lufsMomentary: -9 });

    expect(intake.pushFrame).toHaveBeenCalledOnce();
    expect(result.current.latestAudioRef.current).toMatchObject({
      peakDb: [-6],
      momentary: -9,
    });
    expect(setAudio).not.toHaveBeenCalled();
  });
});
