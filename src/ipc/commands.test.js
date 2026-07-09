import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {
    onmessage = null;
  },
}));

import {
  probeFileAnalysis,
  setDialogueGating,
  setDialogueVadEngine,
  setLoudnessWeights,
  startFileAnalysis,
  stopFileAnalysis,
} from "./commands.js";

beforeEach(() => {
  invoke.mockReset();
});

describe("audio engine command seam", () => {
  it("maps dynamic loudness and dialogue settings to native commands", async () => {
    await setLoudnessWeights([1, 0.5]);
    await setDialogueGating(1);
    await setDialogueVadEngine("firered");

    expect(invoke).toHaveBeenNthCalledWith(1, "set_loudness_weights", {
      weights: [1, 0.5],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "set_dialogue_gating", { enabled: true });
    expect(invoke).toHaveBeenNthCalledWith(3, "set_dialogue_vad_engine", {
      engine: "firered",
    });
  });

  it("maps file probing and stopping to native commands", async () => {
    await probeFileAnalysis("C:\\audio.wav");
    await stopFileAnalysis();

    expect(invoke).toHaveBeenNthCalledWith(1, "file_analysis_probe", {
      path: "C:\\audio.wav",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "file_analysis_stop");
  });

  it("bridges file-analysis Channel messages to frame payloads", async () => {
    const onFrame = vi.fn();
    invoke.mockResolvedValue(undefined);

    const channel = await startFileAnalysis({
      path: "C:\\audio.wav",
      probe: { durationMs: 1000 },
      onFrame,
    });

    expect(invoke).toHaveBeenCalledWith("file_analysis_start", {
      path: "C:\\audio.wav",
      probe: { durationMs: 1000 },
      onFrame: channel,
    });

    channel.onmessage({ message: { seq: 7 } });
    channel.onmessage({ seq: 8 });
    channel.onmessage("ignored");

    expect(onFrame).toHaveBeenNthCalledWith(1, { seq: 7 });
    expect(onFrame).toHaveBeenNthCalledWith(2, { seq: 8 });
    expect(onFrame).toHaveBeenCalledTimes(2);
  });
});
