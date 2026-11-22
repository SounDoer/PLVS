import {
  buildVisualDescription,
  dockRecordingRegion,
  recordingUnavailability,
} from "../visualControl.js";
import { visualSemanticFailure } from "../bridge/failures.js";
import { measuredAudioState } from "../bridge/signatures.js";
import { releaseActiveRecording } from "../bridge/visualBookkeeping.js";

const RECORDING_POLL_INTERVAL_MS = 250;
const RECORDING_POLL_RETRY_MAX_MS = 2000;

function isTerminal(recording) {
  return recording.state === "completed" || recording.state === "failed";
}

function publicRecording(recording) {
  const { audioSource, ...publicValue } = recording ?? {};
  return {
    ...publicValue,
    audio: recording?.audio ?? { source: audioSource === "measuredSource" ? audioSource : "none" },
  };
}

function observeRecording(visual, visualControl, recording, revision) {
  const { recordingId } = recording;
  let metadata = visual.recordings.get(recordingId);
  if (isTerminal(recording)) {
    if (!metadata) {
      metadata = {};
      visual.recordings.set(recordingId, metadata);
    }
    metadata.endedRevision ??= revision;
    releaseActiveRecording(visual, visualControl, recordingId);
  } else if (visual.activeRecording.current?.recordingId === recordingId) {
    visualControl.setRecordingState?.(metadata?.indicator === "hidden" ? null : recording.state);
  }
  return metadata;
}

async function pollRecording(visual, visualControl, active, clock) {
  let delay = RECORDING_POLL_INTERVAL_MS;
  while (visual.activeRecording.current === active) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (visual.activeRecording.current !== active) return;
    try {
      const latest = await visualControl.inspectRecording(active.recordingId);
      observeRecording(visual, visualControl, latest, clock.current());
      delay = RECORDING_POLL_INTERVAL_MS;
    } catch (error) {
      if (error?.reason === "recordingNotFound") {
        releaseActiveRecording(visual, visualControl, active.recordingId);
        return;
      }
      delay = Math.min(delay * 2, RECORDING_POLL_RETRY_MAX_MS);
    }
  }
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function describe(ctx) {
  const { requestId, clock } = ctx;
  const visualControl = ctx.live().visual;
  if (!visualControl?.platformCapabilities) {
    throw visualSemanticFailure({ reason: "visualUnavailable" });
  }
  return {
    requestId,
    result: buildVisualDescription({
      revision: clock.current(),
      platform: visualControl.platformCapabilities,
      runtime: visualControl.getRuntime(),
    }),
  };
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function screenshot(ctx) {
  const { request, requestId, clock, visual } = ctx;
  const { uiNavigation } = ctx.snap;
  const visualControl = ctx.live().visual;
  if (visualControl?.platformCapabilities?.screenshot?.available !== true) {
    throw visualSemanticFailure({ reason: "visualUnavailable" });
  }
  const availableTargets = visualControl.getRuntime()?.availableScreenshotTargets ?? [];
  const surfaceKind = request.params.target.kind === "named" ? "main" : request.params.target.kind;
  if (!availableTargets.includes(surfaceKind)) {
    throw visualSemanticFailure({ reason: "targetUnavailable" });
  }
  if (visual.captureActive.current) {
    throw visualSemanticFailure({ reason: "captureBusy" });
  }
  const controller = new AbortController();
  visual.captureActive.current = true;
  visual.captures.set(requestId, controller);
  try {
    const settled = await visualControl.settle(request.params.target, {
      expectedRevision: request.params.expectedRevision,
      getRevision: () => clock.current(),
      expectedUiGeneration: request.params.expectedUiGeneration,
      getUiGeneration: () => uiNavigation?.inspectUi?.().uiGeneration ?? 0,
      signal: controller.signal,
    });
    const artifact = await visualControl.captureScreenshot({
      windowLabel: settled.windowLabel,
      rect: settled.rect,
      viewport: settled.viewport,
      devicePixelRatio: settled.devicePixelRatio,
    });
    const live = ctx.live().measurementContext.getLiveMeasurement?.() ?? {
      generation: 0,
      record: null,
    };
    return {
      requestId,
      result: {
        revision: settled.revision,
        uiGeneration: settled.uiGeneration,
        measurement: {
          generation: Number.isSafeInteger(live.generation) ? live.generation : 0,
          sequence: Number.isSafeInteger(live.record?.sequence) ? live.record.sequence : null,
        },
        artifact,
        target: request.params.target,
        ...(settled.coveredPercent > 0
          ? {
              warnings: [
                {
                  code: "targetOccluded",
                  coveredPercent: settled.coveredPercent,
                  openSurfaces: (uiNavigation?.inspectUi?.().surfaces ?? []).map(
                    ({ surfaceId, kind }) => ({ surfaceId, kind })
                  ),
                },
              ],
            }
          : {}),
      },
    };
  } catch (error) {
    throw visualSemanticFailure(error);
  } finally {
    visual.captures.delete(requestId);
    visual.captureActive.current = false;
  }
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function startRecording(ctx) {
  const { request, requestId, clock, visual } = ctx;
  const visualControl = ctx.live().visual;
  const unavailable = recordingUnavailability(visualControl?.platformCapabilities);
  if (unavailable) throw visualSemanticFailure(unavailable);
  const availableTargets = visualControl.getRuntime()?.availableScreenshotTargets ?? [];
  const runtime = visualControl.getRuntime?.() ?? {};
  // `dock` records the strip's screen region, toolbar and editor included; it is not a WebView.
  const dockTarget = request.params.target.kind === "dock";
  const surfaceTarget = dockTarget ? { kind: "main" } : request.params.target;
  const region = (geometry, edge) =>
    dockTarget ? { ...geometry, ...dockRecordingRegion(geometry, edge) } : geometry;
  if (
    dockTarget
      ? runtime.windowForm !== "dock" ||
        !(visualControl.platformCapabilities.recording.targets ?? []).includes("dock")
      : !availableTargets.includes(request.params.target.kind)
  ) {
    throw visualSemanticFailure({ reason: "targetUnavailable" });
  }
  if (
    !(visualControl.platformCapabilities.recording.cursorModes ?? []).includes(
      request.params.cursor
    )
  ) {
    throw visualSemanticFailure({ reason: "visualUnavailable" });
  }
  const preferredAudio = runtime.sourceMode === "file" ? "none" : "measuredSource";
  const audio =
    request.params.audio ??
    ((runtime.availableAudioSources ?? []).includes(preferredAudio) ? preferredAudio : "none");
  if (!(runtime.availableAudioSources ?? []).includes(audio)) {
    throw visualSemanticFailure({ reason: "audioUnavailable" });
  }
  const audioState = measuredAudioState(runtime, ctx.live().transport);
  const controller = new AbortController();
  visual.captures.set(requestId, controller);
  try {
    const settled = region(
      await visualControl.settle(surfaceTarget, {
        expectedRevision: request.params.expectedRevision,
        getRevision: () => clock.current(),
        signal: controller.signal,
      }),
      ctx.live().dock?.edge
    );
    const recording = await visualControl.startRecording({
      windowLabel: settled.windowLabel,
      rect: settled.rect,
      viewport: settled.viewport,
      devicePixelRatio: settled.devicePixelRatio,
      screenRegion: dockTarget,
      fps: request.params.fps,
      maxDurationSeconds: request.params.maxDurationSeconds,
      audio,
      cursor: request.params.cursor,
      sourceMode: runtime.sourceMode === "file" ? "file" : "live",
      audioState,
    });
    const metadata = {
      target: request.params.target,
      startedRevision: settled.revision,
      startedAt: new Date().toISOString(),
      indicator: request.params.indicator ?? "visible",
    };
    visual.recordings.set(recording.recordingId, metadata);
    if (controller.signal.aborted) {
      await visualControl.stopRecording(recording.recordingId);
      throw { reason: "captureFailed" };
    }
    const previous = visual.activeRecording.current;
    previous?.unsubscribe?.();
    const active = { recordingId: recording.recordingId, audio, unsubscribe: undefined };
    visual.activeRecording.current = active;
    active.unsubscribe = visualControl.subscribe?.(
      surfaceTarget,
      (geometry, edge = ctx.live().dock?.edge) => {
        if (
          visual.activeRecording.current !== active ||
          (dockTarget && (!edge || visualControl.getRuntime()?.windowForm !== "dock"))
        ) {
          return;
        }
        const next = region(geometry, edge);
        void visualControl
          .updateRecordingGeometry({
            recordingId: recording.recordingId,
            rect: next.rect,
            viewport: next.viewport,
          })
          .catch(() => undefined);
      },
      { signal: controller.signal, followDockEdge: dockTarget }
    );
    observeRecording(visual, visualControl, recording, clock.current());
    void pollRecording(visual, visualControl, active, clock);
    return {
      requestId,
      result: {
        revision: settled.revision,
        recording: {
          ...publicRecording(recording),
          target: request.params.target,
          indicator: metadata.indicator,
          startedAt: metadata.startedAt,
          startedRevision: settled.revision,
        },
      },
    };
  } catch (error) {
    throw visualSemanticFailure(error);
  } finally {
    visual.captures.delete(requestId);
  }
}

/** @param {import("../bridge/types.js").BridgeContext} ctx */
async function inspectWaitOrStopRecording(ctx) {
  const { request, requestId, clock, visual } = ctx;
  const visualControl = ctx.live().visual;
  if (visualControl?.platformCapabilities?.recording?.available !== true) {
    throw visualSemanticFailure({ reason: "visualUnavailable" });
  }
  const recordingId = request.params.recordingId;
  const decorate = (recording) => {
    const revision = clock.current();
    const metadata = observeRecording(visual, visualControl, recording, revision);
    return {
      ...publicRecording(recording),
      ...(metadata?.indicator ? { indicator: metadata.indicator } : {}),
      ...(metadata?.target ? { target: metadata.target } : {}),
      ...(metadata?.startedAt ? { startedAt: metadata.startedAt } : {}),
      ...(Number.isSafeInteger(metadata?.startedRevision)
        ? { startedRevision: metadata.startedRevision }
        : {}),
      currentRevision: revision,
      ...(isTerminal(recording) ? { endedRevision: metadata.endedRevision } : {}),
    };
  };
  try {
    if (request.method === "visual.recording.inspect") {
      return {
        requestId,
        result: {
          revision: clock.current(),
          recording: decorate(await visualControl.inspectRecording(recordingId)),
        },
      };
    }
    if (request.method === "visual.recording.stop") {
      await visualControl.stopRecording(recordingId);
    }
    const timeoutMs = request.method === "visual.recording.wait" ? request.params.timeoutMs : 9000;
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const recording = await visualControl.inspectRecording(recordingId);
      if (isTerminal(recording)) {
        return {
          requestId,
          result: {
            ...(request.method === "visual.recording.wait" ? { outcome: "terminal" } : {}),
            revision: clock.current(),
            recording: decorate(recording),
          },
        };
      }
      if (Date.now() >= deadline) {
        if (request.method === "visual.recording.stop") {
          throw {
            reason: "recordingFailed",
            details: {
              finalizationTimedOut: true,
              recording: decorate(recording),
            },
          };
        }
        return {
          requestId,
          result: {
            ...(request.method === "visual.recording.wait" ? { outcome: "timeout" } : {}),
            revision: clock.current(),
            recording: decorate(recording),
          },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch (error) {
    throw visualSemanticFailure(error);
  }
}

/** @type {Record<string, import("../bridge/types.js").HandlerEntry>} */
export const visualHandlers = {
  "visual.describe": { run: describe, lane: "direct" },
  "visual.screenshot": { run: screenshot, lane: "direct" },
  "visual.recording.start": { run: startRecording, lane: "direct" },
  "visual.recording.inspect": { run: inspectWaitOrStopRecording, lane: "direct" },
  "visual.recording.wait": { run: inspectWaitOrStopRecording, lane: "direct" },
  "visual.recording.stop": { run: inspectWaitOrStopRecording, lane: "direct" },
};
