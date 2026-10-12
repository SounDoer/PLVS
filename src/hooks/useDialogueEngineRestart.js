import { useEffect, useRef } from "react";

/**
 * Changing the detector restarts the measurement. The dialogue accumulator resets on an engine
 * switch while `integrated` does not (src-tauri/src/dsp/loudness.rs), so without this the two
 * would be measuring different time windows and LDR would subtract one from the
 * other and still render a number. `dialogueGating` remains an explicit future-compatible
 * boundary even though the current product keeps detection enabled by default.
 *
 * @param {string} dialogueVadEngine - current engine, from settings.
 * @param {boolean} dialogueGating - whether the dialogue detector is currently running.
 * @param {{ current: (() => void) | null }} onClearRef - ref whose `.current` is the latest clearAll.
 */
export function useDialogueEngineRestart(dialogueVadEngine, dialogueGating, onClearRef) {
  const previousDialogueVadEngineRef = useRef(dialogueVadEngine);
  useEffect(() => {
    if (previousDialogueVadEngineRef.current === dialogueVadEngine) return;
    previousDialogueVadEngineRef.current = dialogueVadEngine;
    if (!dialogueGating) return;
    onClearRef?.current?.();
  }, [dialogueVadEngine, dialogueGating, onClearRef]);
}

/**
 * Stored channel-role overrides affect both BS.1770 weighting and the future detector-feed policy.
 * Clear a running Live measurement coherently instead of letting old and new methods share one
 * session.
 *
 * @param {Record<number, string[]>} channelLabelOverrides
 * @param {boolean} live
 * @param {{ current: (() => void) | null }} onClearRef
 */
export function useChannelRolesRestart(channelLabelOverrides, live, onClearRef) {
  const key = JSON.stringify(channelLabelOverrides);
  const previousKeyRef = useRef(key);
  useEffect(() => {
    if (previousKeyRef.current === key) return;
    previousKeyRef.current = key;
    if (!live) return;
    onClearRef?.current?.();
  }, [key, live, onClearRef]);
}
