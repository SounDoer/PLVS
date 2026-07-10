import { useState } from "react";
import { settingsStore } from "../persistence/index.js";
import {
  DEFAULT_HISTORY_RETENTION_SEC,
  normalizeHistoryRetentionSec,
} from "../settings/defaults.js";

export function useHistoryRetentionSetting() {
  const [historyRetentionSec, setHistoryRetentionSecState] = useState(() =>
    normalizeHistoryRetentionSec(settingsStore.read().historyRetentionSec)
  );

  function setHistoryRetentionSec(value) {
    const next = normalizeHistoryRetentionSec(Number(value));
    if (next === DEFAULT_HISTORY_RETENTION_SEC) {
      const { historyRetentionSec: _drop, ...rest } = settingsStore.read();
      settingsStore.reset();
      settingsStore.patch(rest);
    } else {
      settingsStore.patch({ historyRetentionSec: next });
    }
    setHistoryRetentionSecState(next);
  }

  return {
    historyRetentionSec,
    setHistoryRetentionSec,
  };
}
