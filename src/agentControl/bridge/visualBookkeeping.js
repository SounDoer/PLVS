/**
 * What the bridge remembers about visual capture between requests: the abort controller of each
 * screenshot or recording start in flight, recording metadata for later queries, and the active
 * recording that owns the indicator, geometry and audio updates.
 */
export function createVisualBookkeeping() {
  return {
    /** @type {Map<string, AbortController>} */
    captures: new Map(),
    /** @type {Map<string, any>} */
    recordings: new Map(),
    /** @type {{ current: { recordingId: string, audio: string, unsubscribe?: () => void } | null }} */
    activeRecording: { current: null },
    captureActive: { current: false },
  };
}

export function releaseActiveRecording(visual, visualControl, recordingId) {
  const active = visual.activeRecording.current;
  if (active?.recordingId !== recordingId) return;
  visual.activeRecording.current = null;
  active.unsubscribe?.();
  visualControl?.setRecordingState?.(null);
}
