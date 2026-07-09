import { useState } from "react";
import { settingsStore } from "../persistence/index.js";
import { DEFAULT_CLOSE_ACTION, normalizeCloseAction } from "../settings/defaults.js";

export function useCloseActionSetting() {
  const [closeAction, setCloseActionState] = useState(() =>
    normalizeCloseAction(settingsStore.read().closeAction)
  );

  function setCloseAction(value) {
    const next = normalizeCloseAction(value);
    if (next === DEFAULT_CLOSE_ACTION) {
      const { closeAction: _drop, ...rest } = settingsStore.read();
      settingsStore.reset();
      settingsStore.patch(rest);
    } else {
      settingsStore.patch({ closeAction: next });
    }
    setCloseActionState(next);
  }

  return {
    closeAction,
    setCloseAction,
  };
}
