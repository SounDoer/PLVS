import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";
import { useAudioEngine } from "./useAudioEngine.js";

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));

vi.mock("../ipc/commands.js", () => ({
  listAudioDevices: vi.fn(),
  previewAudioDevice: vi.fn(),
  startAudioCapture: vi.fn(),
  stopAudioCapture: vi.fn(),
  setLoudnessWeights: vi.fn(),
  setDialogueGating: vi.fn(),
  setDialogueVadEngine: vi.fn(),
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
  halt,
  histMaxSamples = 10,
  visualMaxSamples = 10,
  ...props
}) {
  const audioRef = useRef(null);
  const frameRef = useRef(0);
  const selectedOffsetRef = useRef(-1);
  const loudnessWeightsRef = useRef(null);
  const dialogueGatingRef = useRef(false);
  const dialogueVadEngineRef = useRef("silero");
  const display = {
    frameRef,
    selectedOffsetRef,
    setAudio,
    setSelectedOffset,
    raiseNotice,
    setShowClock,
    clock: { resetTimer },
  };

  useAudioEngine({
    captureDeviceId: "default",
    histMaxSamples,
    visualMaxSamples,
    audioRef,
    loudnessWeightsRef,
    dialogueGatingRef,
    dialogueVadEngineRef,
    transport: { running: true, halt },
    display,
    ...props,
  });

  return { audioRef, frameRef };
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

  it("clears local meter state when capture format changes during a running session", async () => {
    const props = {
      captureFormatSignature: "2:48000",
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
        peakHoldDb: [],
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
});
