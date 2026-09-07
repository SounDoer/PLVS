export const VISUAL_TARGET_KINDS = Object.freeze([
  "main",
  "workspace",
  "panel",
  "dockHeader",
  "dockEditor",
]);

export const VISUAL_SCREENSHOT_TARGET_KINDS = VISUAL_TARGET_KINDS;
export const VISUAL_RECORDING_TARGET_KINDS = Object.freeze(["main", "workspace"]);
export const VISUAL_AUDIO_SOURCES = Object.freeze(["none", "measuredSource"]);
export const VISUAL_RECORDING_STATES = Object.freeze([
  "starting",
  "recording",
  "stopping",
  "completed",
  "failed",
]);

export const VISUAL_SCREENSHOT_METHODS = Object.freeze(["visual.describe", "visual.screenshot"]);
export const VISUAL_RECORDING_METHODS = Object.freeze([
  "visual.recording.start",
  "visual.recording.inspect",
  "visual.recording.wait",
  "visual.recording.stop",
]);

const SCREENSHOT_FORMAT = "png";
const RECORDING_CONTAINER = "mp4";
const RECORDING_VIDEO_CODEC = "h264";
const SUPPORTED_FPS = Object.freeze([15, 30, 60]);

function isPlainJsonObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function normalizeVisualTarget(value) {
  if (!isPlainJsonObject(value)) {
    return {
      ok: false,
      path: "",
      message: "target must be a plain semantic target object.",
    };
  }

  const allowedFields = value.kind === "panel" ? new Set(["kind", "panelId"]) : new Set(["kind"]);
  const extraField = Object.keys(value).find((key) => !allowedFields.has(key));
  if (extraField) {
    return {
      ok: false,
      path: `.${extraField}`,
      message: `Unknown target field: ${extraField}.`,
    };
  }
  if (!VISUAL_TARGET_KINDS.includes(value.kind)) {
    return {
      ok: false,
      path: ".kind",
      message: `target.kind must be one of: ${VISUAL_TARGET_KINDS.join(", ")}.`,
    };
  }
  if (value.kind === "panel") {
    if (typeof value.panelId !== "string" || value.panelId.trim() === "") {
      return {
        ok: false,
        path: ".panelId",
        message: "target.panelId must be a non-empty string for a Panel target.",
      };
    }
    return { ok: true, target: { kind: value.kind, panelId: value.panelId } };
  }
  return { ok: true, target: { kind: value.kind } };
}

function retainKnown(values, allowed) {
  if (!Array.isArray(values)) return [];
  return allowed.filter((value) => values.includes(value));
}

export function buildVisualDescription({ revision, platform, runtime }) {
  const screenshotAvailable = platform?.screenshot?.available === true;
  const recordingAvailable = platform?.recording?.available === true;
  const screenshotTargets = screenshotAvailable
    ? retainKnown(platform.screenshot.targets, VISUAL_SCREENSHOT_TARGET_KINDS)
    : [];
  const recordingTargets = recordingAvailable
    ? retainKnown(platform.recording.targets, VISUAL_RECORDING_TARGET_KINDS)
    : [];
  const audioSources = recordingAvailable
    ? retainKnown(platform.recording.audioSources, VISUAL_AUDIO_SOURCES)
    : [];

  return {
    revision,
    platform: String(platform?.platform ?? "unknown"),
    screenshot: {
      available: screenshotAvailable,
      targets: screenshotTargets,
      format: SCREENSHOT_FORMAT,
      maxConcurrent: 1,
    },
    recording: {
      available: recordingAvailable,
      targets: recordingTargets,
      container: RECORDING_CONTAINER,
      videoCodec: RECORDING_VIDEO_CODEC,
      audioSources,
      defaultAudioSource: "none",
      defaultFps: 30,
      supportedFps: [...SUPPORTED_FPS],
      defaultMaxDurationSeconds: 60,
      maximumDurationSeconds: 1800,
      maximumArtifactBytes: 2 * 1024 * 1024 * 1024,
      maxConcurrent: 1,
    },
    runtime: {
      windowForm: runtime?.windowForm === "dock" ? "dock" : "normal",
      sourceMode: runtime?.sourceMode === "file" ? "file" : "live",
      availableScreenshotTargets: retainKnown(
        runtime?.availableScreenshotTargets,
        screenshotTargets
      ),
      availableAudioSources: retainKnown(runtime?.availableAudioSources, audioSources),
    },
  };
}
