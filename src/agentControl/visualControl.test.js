import { describe, expect, it } from "vitest";
import {
  VISUAL_AUDIO_SOURCES,
  VISUAL_RECORDING_METHODS,
  VISUAL_RECORDING_STATES,
  VISUAL_RECORDING_TARGET_KINDS,
  VISUAL_SCREENSHOT_METHODS,
  VISUAL_SCREENSHOT_TARGET_KINDS,
  buildVisualDescription,
  normalizeVisualTarget,
} from "./visualControl.js";

describe("visual control contract", () => {
  it("freezes the public target, audio, and recording-state vocabularies", () => {
    expect(VISUAL_SCREENSHOT_TARGET_KINDS).toEqual([
      "main",
      "workspace",
      "panel",
      "dockHeader",
      "dockEditor",
    ]);
    expect(VISUAL_RECORDING_TARGET_KINDS).toEqual(["main", "workspace"]);
    expect(VISUAL_AUDIO_SOURCES).toEqual(["none", "measuredSource"]);
    expect(VISUAL_RECORDING_STATES).toEqual([
      "starting",
      "recording",
      "stopping",
      "completed",
      "failed",
    ]);
    for (const vocabulary of [
      VISUAL_SCREENSHOT_TARGET_KINDS,
      VISUAL_RECORDING_TARGET_KINDS,
      VISUAL_AUDIO_SOURCES,
      VISUAL_RECORDING_STATES,
    ]) {
      expect(Object.isFrozen(vocabulary)).toBe(true);
    }
  });

  it("derives Visual method membership from manifest feature gates", () => {
    expect(VISUAL_SCREENSHOT_METHODS).toEqual(["visual.describe", "visual.screenshot"]);
    expect(VISUAL_RECORDING_METHODS).toEqual([
      "visual.recording.start",
      "visual.recording.inspect",
      "visual.recording.wait",
      "visual.recording.stop",
    ]);
  });

  it("accepts only closed semantic target objects", () => {
    expect(normalizeVisualTarget({ kind: "panel", panelId: "spectrum-2" })).toEqual({
      ok: true,
      target: { kind: "panel", panelId: "spectrum-2" },
    });
    expect(normalizeVisualTarget({ kind: "workspace" })).toEqual({
      ok: true,
      target: { kind: "workspace" },
    });
    for (const target of [
      "#workspace",
      { kind: "workspace", selector: "#workspace" },
      { kind: "main", hwnd: 42 },
      { kind: "main", url: "https://example.com" },
      { kind: "main", path: "capture.png" },
      { kind: "panel" },
      { kind: "main", panelId: "spectrum" },
    ]) {
      expect(normalizeVisualTarget(target).ok).toBe(false);
    }
  });

  it("projects deterministic platform and runtime capabilities", () => {
    const description = buildVisualDescription({
      revision: 18,
      platform: {
        platform: "windows",
        screenshot: {
          available: true,
          targets: ["dockEditor", "panel", "main", "workspace", "dockHeader", "unknown"],
        },
        recording: {
          available: true,
          targets: ["workspace", "main", "panel"],
          audioSources: ["measuredSource", "none", "microphone"],
          cursorModes: ["visible", "none", "system"],
        },
      },
      runtime: {
        windowForm: "normal",
        sourceMode: "live",
        availableScreenshotTargets: ["panel", "main", "workspace"],
        availableAudioSources: ["measuredSource", "none"],
      },
    });

    expect(description).toEqual({
      revision: 18,
      platform: "windows",
      screenshot: {
        available: true,
        targets: ["main", "workspace", "panel", "dockHeader", "dockEditor"],
        format: "png",
        maxConcurrent: 1,
      },
      recording: {
        available: true,
        targets: ["main", "workspace"],
        container: "mp4",
        videoCodec: "h264",
        audioSources: ["none", "measuredSource"],
        defaultAudioSource: "measuredSource",
        cursorModes: ["none", "visible"],
        defaultCursorMode: "none",
        defaultFps: 30,
        supportedFps: [15, 30, 60],
        defaultMaxDurationSeconds: 60,
        maximumDurationSeconds: 1800,
        maximumArtifactBytes: 2147483648,
        maxConcurrent: 1,
      },
      runtime: {
        windowForm: "normal",
        sourceMode: "live",
        availableScreenshotTargets: ["main", "workspace", "panel"],
        availableAudioSources: ["none", "measuredSource"],
      },
    });
    expect(JSON.parse(JSON.stringify(description))).toEqual(description);
  });

  it("does not infer platform availability from the platform name", () => {
    expect(
      buildVisualDescription({
        revision: 0,
        platform: { platform: "windows", screenshot: {}, recording: {} },
        runtime: {},
      })
    ).toMatchObject({
      screenshot: { available: false, targets: [] },
      recording: {
        available: false,
        targets: [],
        audioSources: [],
        cursorModes: [],
        defaultCursorMode: "none",
      },
      runtime: { availableScreenshotTargets: [], availableAudioSources: [] },
    });
  });
});
