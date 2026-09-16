/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useAudioEngine } from "./useAudioEngine.js";

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));

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
    transport: { running: true, halt, recordAudioDrop },
    display,
    ...props,
  });

  return { audioRef, frameRef, latestAudioRef, selectedOffsetRef };
}

describe("useAudioEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAudioDevices.mockResolvedValue([
      {
        id: "lb-main",
        label: "Speakers",
        isSystemOutputMonitor: true,
        defaultSampleRate: 48000,
        channels: 2,
      },
    ]);
    previewAudioDevice.mockResolvedValue({
      label: "Speakers",
      sampleRateHz: 48000,
      channels: 2,
    });
    startAudioCapture.mockResolvedValue(undefined);
    stopAudioCapture.mockResolvedValue(undefined);
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

  it("restarts and clears local meter state when history capacity changes during a running session", async () => {
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

    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledTimes(1));
    expect(stopAudioCapture).toHaveBeenCalledTimes(1);
    expect(props.intake.reset).toHaveBeenCalledTimes(1);
    expect(result.current.frameRef.current).toBe(0);
    expect(props.setSelectedOffset).toHaveBeenCalledWith(-1);
    expect(props.resetTimer).toHaveBeenCalledWith({ restart: true });
    expect(props.setShowClock).toHaveBeenCalledWith(true);
  });

  it("raises a transport notice when native capture cannot start", async () => {
    listAudioDevices.mockRejectedValue(new Error("Audio unavailable"));
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
      expect(props.raiseNotice).toHaveBeenCalledWith("error", "Error: Audio unavailable")
    );
  });

  it("halts LIVE with the engine's reason when capture fails after starting", async () => {
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
    act(() => engineEvents.state({ state: "error", error: reason }));
    expect(props.halt).toHaveBeenCalledWith(expect.objectContaining({ message: reason }));
    expect(props.stopTimer).toHaveBeenCalled();
    expect(props.setSelectedOffset).toHaveBeenCalledWith(-1);
    expect(props.raiseNotice).toHaveBeenCalledWith("error", `Error: ${reason}`);
  });

  it("rebuilds an invalidated device stream once and clears the Live measurement", async () => {
    const props = {
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
        reason: "deviceInvalidated",
      })
    );

    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());
    expect(stopAudioCapture).toHaveBeenCalledOnce();
    expect(props.halt).not.toHaveBeenCalled();
    expect(props.intake.reset).toHaveBeenCalledOnce();
    expect(result.current.frameRef.current).toBe(0);
    expect(props.resetTimer).toHaveBeenCalledWith({ restart: true });

    const recoveredFrame = startAudioCapture.mock.calls[0][0].onFrame;
    act(() => recoveredFrame({ seq: 0, peakDb: [-12], rmsDb: [-24] }));
    expect(props.raiseNotice).toHaveBeenCalledWith(
      "info",
      "Audio configuration changed — measurement restarted"
    );
  });

  it("does not loop when the replacement stream invalidates before delivering a frame", async () => {
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
    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());
    vi.clearAllMocks();

    act(() =>
      engineEvents.state({
        state: "error",
        error: "first invalidation",
        reason: "deviceInvalidated",
      })
    );
    await waitFor(() => expect(startAudioCapture).toHaveBeenCalledOnce());

    act(() =>
      engineEvents.state({
        state: "error",
        error: "replacement invalidated",
        reason: "deviceInvalidated",
      })
    );
    expect(props.halt).toHaveBeenCalledWith(
      expect.objectContaining({ message: "replacement invalidated" })
    );
    expect(startAudioCapture).toHaveBeenCalledOnce();
    expect(props.raiseNotice).toHaveBeenCalledWith("error", "Error: replacement invalidated");
  });

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

    const onFrame = startAudioCapture.mock.calls[0][0].onFrame;
    act(() => onFrame({ seq: 1, peakDb: [-4], rmsDb: [-16] }));
    expect(measurementOwner.capture).toHaveBeenCalledWith(
      expect.objectContaining({ seq: 1 }),
      expect.objectContaining({ peakDb: [-4], rmsDb: [-16] }),
      { dialogueActive: false }
    );
  });

  it("aborts a pending LIVE measurement session when native start fails", async () => {
    startAudioCapture.mockRejectedValueOnce(new Error("start failed"));
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
    stopAudioCapture.mockReturnValueOnce(
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

    const onFrame = startAudioCapture.mock.calls[0][0].onFrame;
    onFrame({ peakDb: [-6], lufsMomentary: -9 });

    expect(intake.pushFrame).toHaveBeenCalledOnce();
    expect(result.current.latestAudioRef.current).toMatchObject({
      peakDb: [-6],
      momentary: -9,
    });
    expect(setAudio).not.toHaveBeenCalled();
  });
});
