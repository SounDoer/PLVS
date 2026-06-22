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
}));

import {
  listAudioDevices,
  previewAudioDevice,
  startAudioCapture,
  stopAudioCapture,
} from "../ipc/commands.js";

function useHarness(props) {
  const audioRef = useRef(null);
  const rafRef = useRef(0);
  const frameRef = useRef(0);
  const selectedOffsetRef = useRef(-1);
  const loudnessWeightsRef = useRef(null);
  const dialogueGatingRef = useRef(false);

  useAudioEngine({
    running: true,
    captureDeviceId: "default",
    histMaxSamples: 10,
    visualMaxSamples: 10,
    audioRef,
    rafRef,
    frameRef,
    selectedOffsetRef,
    loudnessWeightsRef,
    dialogueGatingRef,
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
      setHistoryPathM: vi.fn(),
      setHistoryPathST: vi.fn(),
      setStatus: vi.fn(),
      setStatus2: vi.fn(),
      setRunning: vi.fn(),
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
    expect(props.setHistoryPathM).toHaveBeenCalledWith("");
    expect(props.setHistoryPathST).toHaveBeenCalledWith("");
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
});
