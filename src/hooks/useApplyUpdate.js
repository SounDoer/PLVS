import { useCallback, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * Drives the download + install step for an Update handle returned by
 * checkForUpdate(), separate from the periodic check itself.
 */
export function useApplyUpdate() {
  const [installStatus, setInstallStatus] = useState("idle");

  const restartToApply = useCallback(async () => {
    setInstallStatus("restarting");
    try {
      await relaunch();
    } catch {
      setInstallStatus("restart-error");
    }
  }, []);

  const install = useCallback(
    async (update) => {
      if (!update) return;

      setInstallStatus("installing");
      try {
        await update.downloadAndInstall();
      } catch {
        setInstallStatus("install-error");
        return;
      }

      await restartToApply();
    },
    [restartToApply]
  );

  const resetInstall = useCallback(() => {
    setInstallStatus("idle");
  }, []);

  return { installStatus, install, restartToApply, resetInstall };
}
