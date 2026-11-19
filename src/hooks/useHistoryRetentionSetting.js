import { useState } from "react";
import { settingsStore } from "../persistence/index.js";
import {
  DEFAULT_HISTORY_RETENTION_SEC,
  normalizeHistoryRetentionSec,
} from "../settings/defaults.js";

/** @param {{ onChangeRef?: { current?: (() => any) | null } }} [options] */
export function useHistoryRetentionSetting({ onChangeRef } = {}) {
  const [historyRetentionSec, setHistoryRetentionSecState] = useState(() =>
    normalizeHistoryRetentionSec(settingsStore.read().historyRetentionSec)
  );

  async function setHistoryRetentionSec(value) {
    const next = normalizeHistoryRetentionSec(Number(value));
    if (next === historyRetentionSec) return false;
    if (next === DEFAULT_HISTORY_RETENTION_SEC) {
      settingsStore.unset("historyRetentionSec");
    } else {
      settingsStore.patch({ historyRetentionSec: next });
    }
    setHistoryRetentionSecState(next);
    await onChangeRef?.current?.();
    return true;
  }

  return {
    historyRetentionSec,
    setHistoryRetentionSec,
  };
}
