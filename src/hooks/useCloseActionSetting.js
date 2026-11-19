import { useEffect, useState } from "react";
import { settingsStore } from "../persistence/index.js";
import { DEFAULT_CLOSE_ACTION, normalizeCloseAction } from "../settings/defaults.js";

export function useCloseActionSetting() {
  const [closeAction, setCloseActionState] = useState(() =>
    normalizeCloseAction(settingsStore.read().closeAction)
  );
  useEffect(
    () =>
      settingsStore.subscribe(() =>
        setCloseActionState(normalizeCloseAction(settingsStore.read().closeAction))
      ),
    []
  );

  /**
   * @param {string} value
   */
  function setCloseAction(value) {
    const next = normalizeCloseAction(value);
    if (next === DEFAULT_CLOSE_ACTION) {
      settingsStore.unset("closeAction");
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
