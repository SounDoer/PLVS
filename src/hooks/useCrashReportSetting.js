import { useCallback, useEffect, useState } from "react";
import { setCrashPromptEnabled } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { settingsStore } from "../persistence/index.js";

function readEnabled() {
  return settingsStore.read().askToSendCrashReports !== false;
}

export function useCrashReportSetting() {
  const [enabled, setEnabledState] = useState(readEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => settingsStore.subscribe(() => setEnabledState(readEnabled())), []);

  const setEnabled = useCallback(async (next) => {
    const enabledValue = !!next;
    setBusy(true);
    setError("");
    try {
      if (isTauri()) await setCrashPromptEnabled(enabledValue);
      settingsStore.patch({ askToSendCrashReports: enabledValue });
      setEnabledState(enabledValue);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message || "Unable to update crash-report preference.");
      throw cause;
    } finally {
      setBusy(false);
    }
  }, []);

  return { enabled, busy, error, setEnabled };
}
