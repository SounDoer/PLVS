import { useCallback, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Drives the download + install step for an Update handle returned by
 * checkForUpdate(), separate from the periodic check itself.
 */
export function useApplyUpdate() {
  const [installStatus, setInstallStatus] = useState("idle");

  const install = useCallback(async (update) => {
    if (!update) return;
    setInstallStatus("installing");
    try {
      await update.downloadAndInstall();
      setInstallStatus("ready");
    } catch {
      setInstallStatus("error");
    }
  }, []);

  const restartToApply = useCallback(() => {
    relaunch();
  }, []);

  return { installStatus, install, restartToApply };
}
