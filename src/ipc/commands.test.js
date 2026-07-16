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
  getDockState,
  reassertDockChrome,
  setDialogueGating,
  setDialogueVadEngine,
  setDockAccessories,
  setDockHeight,
  setDockSuspended,
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

describe("dock command seam", () => {
  it("reads the native-authoritative Dock state", async () => {
    await getDockState();
    expect(invoke).toHaveBeenCalledWith("get_dock_state");
  });
  it("re-asserts native Dock chrome without changing geometry", async () => {
    await reassertDockChrome();
    expect(invoke).toHaveBeenCalledWith("reassert_dock_chrome");
  });
  it("passes logical height and persistence intent to Rust", async () => {
    await setDockHeight({ height: 108, persist: false });
    expect(invoke).toHaveBeenCalledWith("set_dock_height", { height: 108, persist: false });
  });

  it("passes temporary Dock suspension without changing persisted state", async () => {
    await setDockSuspended(true);
    expect(invoke).toHaveBeenCalledWith("set_dock_suspended", { suspended: true });
  });

  it("passes the logical editor trigger anchor to Rust", async () => {
    await setDockAccessories({
      edge: "bottom",
      headerVisible: true,
      editorVisible: true,
      editorWidth: 240,
      editorHeight: 320,
      editorAnchorX: 612.5,
    });
    expect(invoke).toHaveBeenCalledWith("set_dock_accessories", {
      edge: "bottom",
      headerVisible: true,
      editorVisible: true,
      editorWidth: 240,
      editorHeight: 320,
      editorAnchorX: 612.5,
    });
  });
});
