import { buildVisualDescription, recordingUnavailability } from "../visualControl.js";
import { visualSemanticFailure } from "../bridge/failures.js";
import { measuredAudioState } from "../bridge/signatures.js";

function publicRecording(recording) {
  const { audioSource, ...publicValue } = recording ?? {};
  return {
    ...publicValue,
    audio: recording?.audio ?? { source: audioSource === "measuredSource" ? audioSource : "none" },
  };
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
  if (!availableTargets.includes(request.params.target.kind)) {
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
  if (!availableTargets.includes(request.params.target.kind)) {
    throw visualSemanticFailure({ reason: "targetUnavailable" });
  }
  const runtime = visualControl.getRuntime?.() ?? {};
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
    const settled = await visualControl.settle(request.params.target, {
      expectedRevision: request.params.expectedRevision,
      getRevision: () => clock.current(),
      signal: controller.signal,
    });
    const recording = await visualControl.startRecording({
      windowLabel: settled.windowLabel,
      rect: settled.rect,
      viewport: settled.viewport,
      devicePixelRatio: settled.devicePixelRatio,
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
      unsubscribe: null,
      audio,
    };
    visual.recordings.set(recording.recordingId, metadata);
    metadata.unsubscribe = visualControl.subscribe?.(
      request.params.target,
      (geometry) => {
        void visualControl
          .updateRecordingGeometry({
            recordingId: recording.recordingId,
            rect: geometry.rect,
            viewport: geometry.viewport,
          })
          .catch(() => undefined);
      },
      { signal: controller.signal }
    );
    visualControl.setRecordingState?.(recording.state);
    void (async () => {
      while (visual.recordings.has(recording.recordingId)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        try {
          const latest = await visualControl.inspectRecording(recording.recordingId);
          if (latest.state === "completed" || latest.state === "failed") {
            metadata.unsubscribe?.();
            metadata.unsubscribe = null;
            visualControl.setRecordingState?.(null);
            return;
          }
          visualControl.setRecordingState?.(latest.state);
        } catch {
          return;
        }
      }
    })();
    return {
      requestId,
      result: {
        revision: settled.revision,
        recording: {
          ...publicRecording(recording),
          target: request.params.target,
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
  const metadata = visual.recordings.get(recordingId);
  const decorate = (recording) => {
    const terminal = recording.state === "completed" || recording.state === "failed";
    if (terminal) {
      metadata?.unsubscribe?.();
      if (metadata) metadata.unsubscribe = null;
      visualControl.setRecordingState?.(null);
    } else {
      visualControl.setRecordingState?.(recording.state);
    }
    return {
      ...publicRecording(recording),
      ...(metadata?.target ? { target: metadata.target } : {}),
      ...(metadata?.startedAt ? { startedAt: metadata.startedAt } : {}),
      ...(Number.isSafeInteger(metadata?.startedRevision)
        ? { startedRevision: metadata.startedRevision }
        : {}),
      currentRevision: clock.current(),
      ...(terminal ? { endedRevision: clock.current() } : {}),
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
      if (recording.state === "completed" || recording.state === "failed") {
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
