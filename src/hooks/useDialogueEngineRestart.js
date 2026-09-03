import { useEffect, useRef } from "react";

/**
 * Changing the detector restarts the measurement. The dialogue accumulator resets on an engine
 * switch while `integrated` does not (src-tauri/src/dsp/loudness.rs), so without this the two
 * would be measuring different time windows and Dialogue Offset would subtract one from the
 * other and still render a number. Gated on gating: with no dialogue row on screen the switch
 * changes nothing observable, and destroying a running measurement would buy nothing.
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
