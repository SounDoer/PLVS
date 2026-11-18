import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useTransientStatus } from "./useTransientStatus.js";
import { readProfileFile, writeProfileFile } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { pickConfigurationProfileFile, saveConfigurationProfileFile } from "../ipc/fileDialog.js";
import {
  configurationRestartPending,
  exportProfile,
  importProfile,
  reloadAfterProfileChange,
  resetProfile,
  subscribeConfigurationRestart,
} from "../persistence/profile.js";

export function useConfigurationProfileActions() {
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const [configurationStatus, setConfigurationStatus] = useTransientStatus();
  const restartPending = useSyncExternalStore(
    subscribeConfigurationRestart,
    configurationRestartPending
  );
  // Native file dialogs already block interaction. Keep a separate synchronous guard so a dialog
  // cannot be opened twice without presenting the whole configuration section as disabled while
  // the user is only choosing a path.
  const operationActiveRef = useRef(false);

  const restart = useCallback(async () => {
    try {
      await reloadAfterProfileChange();
    } catch (_) {
      setConfigurationStatus("Configuration saved. PLVS could not restart.");
    }
  }, [setConfigurationStatus]);

  const retryConfigurationRestart = useCallback(async () => {
    if (operationActiveRef.current || !configurationRestartPending()) return;
    operationActiveRef.current = true;
    setConfigurationBusy(true);
    setConfigurationStatus("");
    try {
      await restart();
    } finally {
      operationActiveRef.current = false;
      setConfigurationBusy(false);
    }
  }, [restart, setConfigurationStatus]);

  const exportConfiguration = useCallback(async () => {
    if (operationActiveRef.current || configurationRestartPending()) return;
    operationActiveRef.current = true;
    setConfigurationBusy(true);
    setConfigurationStatus("");
    try {
      const profile = await exportProfile();
      const contents = `${JSON.stringify(profile, null, 2)}\n`;
      if (isTauri()) {
        setConfigurationBusy(false);
        const path = await saveConfigurationProfileFile("plvs-configuration.plvsconfig");
        if (!path) {
          setConfigurationStatus("");
          return;
        }
        setConfigurationBusy(true);
        await writeProfileFile(path, contents);
      } else {
        const blob = new Blob([contents], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "plvs-configuration.plvsconfig";
        a.click();
        URL.revokeObjectURL(url);
      }
      setConfigurationStatus("Configuration exported");
    } catch (_) {
      setConfigurationStatus("Export failed");
    } finally {
      operationActiveRef.current = false;
      setConfigurationBusy(false);
    }
  }, [setConfigurationStatus]);

  const importConfiguration = useCallback(async () => {
    if (operationActiveRef.current || configurationRestartPending()) return;
    operationActiveRef.current = true;
    setConfigurationStatus("");
    try {
      if (!isTauri()) {
        setConfigurationStatus("Import is available in the desktop app");
        return;
      }
      const path = await pickConfigurationProfileFile();
      if (!path) {
        setConfigurationStatus("");
        return;
      }
      setConfigurationBusy(true);
      const raw = await readProfileFile(path);
      await importProfile(JSON.parse(raw));
      await restart();
    } catch (_) {
      setConfigurationStatus("Import failed");
    } finally {
      operationActiveRef.current = false;
      setConfigurationBusy(false);
    }
  }, [restart, setConfigurationStatus]);

  const resetConfiguration = useCallback(async () => {
    if (operationActiveRef.current || configurationRestartPending()) return;
    operationActiveRef.current = true;
    setConfigurationBusy(true);
    setConfigurationStatus("");
    try {
      await resetProfile();
      await restart();
    } catch (_) {
      setConfigurationStatus("Reset failed");
    } finally {
      setConfigurationBusy(false);
      operationActiveRef.current = false;
    }
  }, [restart, setConfigurationStatus]);

  return {
    configurationBusy,
    configurationStatus,
    configurationRestartPending: restartPending,
    retryConfigurationRestart,
    exportConfiguration,
    importConfiguration,
    resetConfiguration,
  };
}
