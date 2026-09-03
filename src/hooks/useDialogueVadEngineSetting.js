import { useState } from "react";
import { settingsStore } from "../persistence/index.js";
import { normalizeDialogueVadEngine } from "../settings/defaults.js";

/**
 * The dialogue detector, global to the app. It lives in settings rather than in panel controls
 * because the audio engine has exactly one detector: a per-panel value could only ever be
 * resolved by discarding all but one of them.
 */
export function useDialogueVadEngineSetting() {
  const [dialogueVadEngine, setDialogueVadEngineState] = useState(() =>
    normalizeDialogueVadEngine(settingsStore.read().dialogueVadEngine)
  );

  function setDialogueVadEngine(value) {
    const next = normalizeDialogueVadEngine(value);
    settingsStore.patch({ dialogueVadEngine: next });
    setDialogueVadEngineState(next);
  }

  return { dialogueVadEngine, setDialogueVadEngine };
}
