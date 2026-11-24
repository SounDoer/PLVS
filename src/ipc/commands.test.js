import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  Channel: class {
    onmessage = null;
  },
}));

import {
  agentControlFrontendNotReadyCommand,
  agentControlFrontendReadyCommand,
  agentControlRespondCommand,
  captureVisualScreenshot,
  getUiFrameDiagnostics,
  getVisualCaptureCapabilities,
  listCaptureApplications,
  startFileProbe,
  getDockState,
  setDialogueGating,
  setDialogueVadEngine,
  setDockAccessories,
  setDockHeight,
  setDockSuspended,
  setChannelRoles,
  startAudioCapture,
  startVisualRecording,
  inspectVisualRecording,
  updateVisualRecordingGeometry,
  updateVisualRecordingAudioState,
  stopVisualRecording,
  startFileAnalysis,
  stopFileAnalysis,
  recordFrontendCrash,
  logFrontendError,
  readPendingCrashReport,
  discardCrashReport,
  setCrashPromptEnabled,
  readFeedbackDiagnostics,
} from "./commands.js";

beforeEach(() => {
  invoke.mockReset();
});

it("targets the reserved native probe even if cancel is requested immediately", async () => {
  let reserve = (_probeId) => {};
  let finish = () => {};
  invoke.mockReturnValueOnce(
    new Promise((resolve) => {
      reserve = resolve;
    })
  );
  invoke.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = () => resolve(null);
    })
  );
  invoke.mockResolvedValueOnce(undefined);
  const probe = startFileProbe("audio.wav");
  let cancelled = false;
  const cancellation = probe.cancel().then(() => {
    cancelled = true;
  });
  expect(invoke.mock.calls).toEqual([["file_analysis_reserve_probe"]]);
  reserve(2);
  await Promise.resolve();
  expect(invoke).toHaveBeenNthCalledWith(2, "file_analysis_probe", {
    path: "audio.wav",
    probeId: 2,
  });
  expect(invoke).toHaveBeenNthCalledWith(3, "file_analysis_cancel_probe", { probeId: 2 });
  expect(cancelled).toBe(false);
  finish();
  await cancellation;
  expect(cancelled).toBe(true);
});

it("cancels a signaled file probe and rejects a late successful result", async () => {
  let finish = (_probe) => {};
  invoke
    .mockResolvedValueOnce(17)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    )
    .mockResolvedValueOnce(undefined);
  const controller = new AbortController();
  const probe = startFileProbe("slow.wav", { signal: controller.signal });
  const rejected = expect(probe.result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await Promise.resolve();
  expect(invoke).toHaveBeenCalledWith("file_analysis_cancel_probe", { probeId: 17 });
  finish({ path: "slow.wav" });
  await rejected;
});

describe("crash-report command seam", () => {
  it("maps report lifecycle calls to the exact native payloads", async () => {
    const input = {
      name: "TypeError",
      message: "render failed",
      stack: "stack",
      componentStack: "component stack",
    };

    await recordFrontendCrash(input);
    await logFrontendError("ordinary error");
    await readPendingCrashReport();
    await discardCrashReport("20260916T120000Z-01234567");
    await setCrashPromptEnabled(false);
    await readFeedbackDiagnostics();

    expect(invoke).toHaveBeenNthCalledWith(1, "record_frontend_crash", { input });
    expect(invoke).toHaveBeenNthCalledWith(2, "log_frontend_error", {
      message: "ordinary error",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "read_pending_crash_report");
    expect(invoke).toHaveBeenNthCalledWith(4, "discard_crash_report", {
      id: "20260916T120000Z-01234567",
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "set_crash_prompt_enabled", {
      enabled: false,
    });
    expect(invoke).toHaveBeenNthCalledWith(6, "read_feedback_diagnostics", { frontend: null });
  });
});

describe("audio engine command seam", () => {
  it("lists capture applications through the native boundary", async () => {
    await listCaptureApplications();
    expect(invoke).toHaveBeenCalledWith("list_capture_applications");
  });

  it("passes an optional process target through the IPC boundary", async () => {
    const onFrame = vi.fn();
    const channel = await startAudioCapture({ deviceId: "default", processId: 4242, onFrame });

    expect(invoke).toHaveBeenCalledWith("audio_start", {
      deviceId: "default",
      processId: 4242,
      applicationId: null,
      continueSession: false,
      onFrame: channel,
    });
  });

  it("passes saved mix application IDs as one Live source", async () => {
    const mixApplicationIds = ["app-" + "1".repeat(32), "app-" + "2".repeat(32)];
    const channel = await startAudioCapture({
      deviceId: "default",
      mixApplicationIds,
      onFrame: vi.fn(),
    });
    expect(invoke).toHaveBeenCalledWith("audio_start", {
      deviceId: "default",
      processId: null,
      applicationId: null,
      mixApplicationIds,
      continueSession: false,
      onFrame: channel,
    });
  });

  it("starts a saved Mix with one application and the selected input channels", async () => {
    const mixApplicationIds = ["app-" + "1".repeat(32)];
    const mixInput = { id: "cap-" + "2".repeat(32), channels: [1] };
    const channel = await startAudioCapture({
      deviceId: "default",
      mixApplicationIds,
      mixInput,
      onFrame: vi.fn(),
    });
    expect(invoke).toHaveBeenCalledWith("audio_start", {
      deviceId: "default",
      processId: null,
      applicationId: null,
      mixApplicationIds,
      mixInput,
      continueSession: false,
      onFrame: channel,
    });
  });

  it("applies the reset between older and newer frames and waits for its marker", async () => {
    const observed = [];
    const channel = await startAudioCapture({
      deviceId: "default",
      onFrame: (frame) => observed.push(frame.seq),
    });
    const complete = vi.fn();
    const rules = { channelRoles: ["R", "L"], dialogueGating: true, dialogueVadEngine: "silero" };
    const reset = channel.resetMeter("history", () => observed.push("reset"), rules).then(complete);
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenLastCalledWith("clear_audio_history", {
      streamId: channel.id,
      requestId: 1,
      rules,
    });

    channel.onmessage({ seq: 7 });
    channel.onmessage({ meterReset: 2 });
    channel.onmessage({ meterReset: 1 });
    channel.onmessage({ seq: 8 });
    await reset;

    expect(observed).toEqual([7, "reset", 8]);
    expect(complete).toHaveBeenCalledOnce();
  });

  it("does not apply a failed reset or a late marker from a closed stream", async () => {
    const apply = vi.fn();
    const channel = await startAudioCapture({ deviceId: "default", onFrame: vi.fn() });
    invoke.mockRejectedValueOnce(new Error("reset failed"));
    await expect(channel.resetMeter("truePeakMax", apply)).rejects.toThrow("reset failed");
    channel.onmessage({ meterReset: 1 });

    const reset = channel.resetMeter("truePeakMax", apply);
    channel.closeMeterResets();
    await expect(reset).rejects.toThrow("stopped");
    channel.onmessage({ meterReset: 2 });
    expect(apply).not.toHaveBeenCalled();
  });

  it("reads UI frame diagnostics without changing runtime state", async () => {
    await getUiFrameDiagnostics();
    expect(invoke).toHaveBeenCalledWith("get_ui_frame_diagnostics");
  });

  it("maps channel roles and dialogue settings to native commands", async () => {
    await setChannelRoles(["L", "R"]);
    await setDialogueGating(1);
    await setDialogueVadEngine("firered");

    expect(invoke).toHaveBeenNthCalledWith(1, "set_channel_roles", {
      roles: ["L", "R"],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "set_dialogue_gating", { enabled: true });
    expect(invoke).toHaveBeenNthCalledWith(3, "set_dialogue_vad_engine", {
      engine: "firered",
    });

    await setChannelRoles(null);
    expect(invoke).toHaveBeenNthCalledWith(4, "set_channel_roles", { roles: null });
  });

  it("maps file probing and stopping to native commands", async () => {
    invoke.mockResolvedValueOnce(3);
    await startFileProbe("C:\\audio.wav").result;
    await stopFileAnalysis();

    expect(invoke).toHaveBeenNthCalledWith(1, "file_analysis_reserve_probe");
    expect(invoke).toHaveBeenNthCalledWith(2, "file_analysis_probe", {
      path: "C:\\audio.wav",
      probeId: 3,
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "file_analysis_stop");
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

  it("decodes a binary channel message into the frame shape the UI already reads", async () => {
    // What Rust actually sends now: the JSON envelope with Spectrum's rows moved into sections
    // behind it. The bridge has to hand `onFrame` the same object shape either way.
    const envelope = new TextEncoder().encode(
      JSON.stringify({
        wireVersion: 1,
        seq: 11,
        spectrumResultsByKey: { k: { smoothDb: { $bin: 0, dtype: "f64", len: 2 } } },
      })
    );
    const sectionStart = Math.ceil((4 + envelope.length) / 8) * 8;
    const message = new ArrayBuffer(sectionStart + 16);
    new DataView(message).setUint32(0, envelope.length, true);
    new Uint8Array(message).set(envelope, 4);
    new Float64Array(message, sectionStart, 2).set([-0.25, -0.5]);

    const onFrame = vi.fn();
    invoke.mockResolvedValue(undefined);
    const channel = await startFileAnalysis({ path: "C:\\audio.wav", onFrame, probe: undefined });

    channel.onmessage({ message });

    const frame = onFrame.mock.calls[0][0];
    expect(frame.seq).toBe(11);
    expect(Array.from(frame.spectrumResultsByKey.k.smoothDb)).toEqual([-0.25, -0.5]);
  });
});

describe("agent-control command seam", () => {
  it("maps lifecycle and response payloads without exposing invoke to callers", async () => {
    const response = { requestId: "req-1", result: { ok: true } };
    await agentControlFrontendReadyCommand();
    await agentControlRespondCommand(response);
    await agentControlFrontendNotReadyCommand();

    expect(invoke).toHaveBeenNthCalledWith(1, "agent_control_frontend_ready");
    expect(invoke).toHaveBeenNthCalledWith(2, "agent_control_respond", { response });
    expect(invoke).toHaveBeenNthCalledWith(3, "agent_control_frontend_not_ready");
  });

  it("queries native visual support and forwards settled geometry without a caller path", async () => {
    const request = {
      windowLabel: "main",
      rect: { x: 10, y: 20, width: 300, height: 200 },
      viewport: { width: 800, height: 600 },
      devicePixelRatio: 1.25,
    };
    await getVisualCaptureCapabilities();
    await captureVisualScreenshot(request);

    expect(invoke).toHaveBeenNthCalledWith(1, "visual_capture_capabilities");
    expect(invoke).toHaveBeenNthCalledWith(2, "visual_capture_screenshot", { request });
    expect(invoke.mock.calls[1][1]).not.toHaveProperty("out");
    expect(invoke.mock.calls[1][1]).not.toHaveProperty("path");
  });

  it("maps the native recording lifecycle and keeps geometry updates private", async () => {
    const request = {
      windowLabel: "main",
      rect: { x: 0, y: 0, width: 640, height: 480 },
      viewport: { width: 800, height: 600 },
      devicePixelRatio: 1.25,
      fps: 30,
      maxDurationSeconds: 60,
    };
    await startVisualRecording(request);
    await inspectVisualRecording("rec-1");
    await updateVisualRecordingGeometry({
      recordingId: "rec-1",
      rect: request.rect,
      viewport: request.viewport,
    });
    await updateVisualRecordingAudioState({ recordingId: "rec-1", state: "liveRestart" });
    await stopVisualRecording("rec-1");

    expect(invoke).toHaveBeenNthCalledWith(1, "visual_recording_start", { request });
    expect(invoke).toHaveBeenNthCalledWith(2, "visual_recording_inspect", {
      request: { recordingId: "rec-1" },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "visual_recording_update_geometry", {
      request: {
        recordingId: "rec-1",
        rect: request.rect,
        viewport: request.viewport,
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(4, "visual_recording_update_audio_state", {
      request: { recordingId: "rec-1", state: "liveRestart" },
    });
    expect(invoke).toHaveBeenNthCalledWith(5, "visual_recording_stop", {
      request: { recordingId: "rec-1" },
    });
  });
});

describe("dock command seam", () => {
  it("reads the native-authoritative Dock state", async () => {
    await getDockState();
    expect(invoke).toHaveBeenCalledWith("get_dock_state");
  });
  it("passes logical height and persistence intent to Rust", async () => {
    await setDockHeight({ height: 108, persist: false });
    expect(invoke).toHaveBeenCalledWith("set_dock_height", {
      height: 108,
      persist: false,
      cancelled: false,
      origin: "ui",
    });
  });

  it("passes temporary Dock suspension without changing persisted state", async () => {
    await setDockSuspended(true);
    expect(invoke).toHaveBeenCalledWith("set_dock_suspended", {
      suspended: true,
      origin: "lifecycle",
    });
  });

  it("passes the logical editor trigger anchor to Rust", async () => {
    await setDockAccessories({
      edge: "bottom",
      headerVisible: true,
      editorVisible: true,
      editorWidth: 240,
      editorHeight: 320,
      editorAnchorX: 612.5,
      webviewScale: 1.25,
    });
    expect(invoke).toHaveBeenCalledWith("set_dock_accessories", {
      edge: "bottom",
      headerVisible: true,
      editorVisible: true,
      editorWidth: 240,
      editorHeight: 320,
      editorAnchorX: 612.5,
      webviewScale: 1.25,
    });
  });

  it("reports devicePixelRatio so Rust never converts with a monitor scale factor", async () => {
    // WebView2 folds Windows text scaling into devicePixelRatio; a monitor's
    // scale factor misses it and undersizes the accessory windows.
    vi.stubGlobal("devicePixelRatio", 1.9125);
    await setDockAccessories({ edge: "top", headerVisible: true });
    expect(invoke).toHaveBeenCalledWith(
      "set_dock_accessories",
      expect.objectContaining({ webviewScale: 1.9125 })
    );
    vi.unstubAllGlobals();
  });
});
