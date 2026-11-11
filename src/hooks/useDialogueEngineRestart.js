import { useEffect, useRef } from "react";

/**
 * Changing the detector restarts the measurement. The dialogue accumulator resets on an engine
 * switch while `integrated` does not (src-tauri/src/dsp/loudness.rs), so without this the two
 * would be measuring different time windows and LDR would subtract one from the
 * other and still render a number. `dialogueGating` remains an explicit future-compatible
 * boundary even though the current product keeps detection enabled by default.
 *
 * While File is shown the Live clear is deferred to the return to Live: the File result keeps the
 * detector it was analyzed with, and clearAll would act on the File instead.
 *
 * @param {string} dialogueVadEngine - current engine, from settings.
 * @param {boolean} dialogueGating - whether the dialogue detector is currently running.
 * @param {boolean} live - whether Live is the shown source.
 * @param {{ current: (() => void) | null }} onClearRef - ref whose `.current` is the latest clearAll.
 * @param {() => void} deferLiveClear - owes Live one clear when it is shown again.
 */
export function useDialogueEngineRestart(
  dialogueVadEngine,
  dialogueGating,
  live,
  onClearRef,
  deferLiveClear
) {
  const previousDialogueVadEngineRef = useRef(dialogueVadEngine);
  useEffect(() => {
    if (previousDialogueVadEngineRef.current === dialogueVadEngine) return;
    previousDialogueVadEngineRef.current = dialogueVadEngine;
    if (!dialogueGating) return;
    if (live) onClearRef?.current?.();
    else deferLiveClear?.();
  }, [dialogueVadEngine, dialogueGating, live, onClearRef, deferLiveClear]);
}

/**
 * Stored channel-role overrides affect both BS.1770 weighting and the future detector-feed policy.
 * Clear a running Live measurement coherently instead of letting old and new methods share one
 * session. While File is shown the clear is deferred to the return to Live, as for the detector.
 *
 * @param {Record<number, string[]>} channelLabelOverrides
 * @param {boolean} live
 * @param {{ current: (() => void) | null }} onClearRef
 * @param {() => void} deferLiveClear
 */
export function useChannelRolesRestart(channelLabelOverrides, live, onClearRef, deferLiveClear) {
  const key = JSON.stringify(channelLabelOverrides);
  const previousKeyRef = useRef(key);
  useEffect(() => {
    if (previousKeyRef.current === key) return;
    previousKeyRef.current = key;
    if (live) onClearRef?.current?.();
    else deferLiveClear?.();
  }, [key, live, onClearRef, deferLiveClear]);
}
