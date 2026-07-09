import { useCallback, useState } from "react";
import { readProfileFile, writeProfileFile } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { pickConfigurationProfileFile, saveConfigurationProfileFile } from "../ipc/fileDialog.js";
import {
  exportProfile,
  importProfile,
  reloadAfterProfileChange,
  resetProfile,
} from "../persistence/profile.js";

export function useConfigurationProfileActions() {
  const [configurationBusy, setConfigurationBusy] = useState(false);
  const [configurationStatus, setConfigurationStatus] = useState("");

  const exportConfiguration = useCallback(async () => {
    if (configurationBusy) return;
    setConfigurationBusy(true);
    setConfigurationStatus("");
    try {
      const profile = await exportProfile();
      const contents = `${JSON.stringify(profile, null, 2)}\n`;
      if (isTauri()) {
        const path = await saveConfigurationProfileFile("plvs-configuration.plvsconfig");
        if (!path) {
          setConfigurationStatus("");
          return;
        }
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
      setConfigurationBusy(false);
    }
  }, [configurationBusy]);

  const importConfiguration = useCallback(async () => {
    if (configurationBusy) return;
    setConfigurationBusy(true);
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
      const raw = await readProfileFile(path);
      await importProfile(JSON.parse(raw));
      reloadAfterProfileChange();
    } catch (_) {
      setConfigurationStatus("Import failed");
    } finally {
      setConfigurationBusy(false);
    }
  }, [configurationBusy]);

  const resetConfiguration = useCallback(async () => {
    if (configurationBusy) return;
    setConfigurationBusy(true);
    setConfigurationStatus("");
    try {
      await resetProfile();
      reloadAfterProfileChange();
    } catch (_) {
      setConfigurationStatus("Reset failed");
      setConfigurationBusy(false);
    }
  }, [configurationBusy]);

  return {
    configurationBusy,
    configurationStatus,
    exportConfiguration,
    importConfiguration,
    resetConfiguration,
  };
}
