import { useCallback, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";

const UPDATE_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Drives the download + install step for an Update handle returned by
 * checkForUpdate(), separate from the periodic check itself.
 */
export function useApplyUpdate() {
  const [installStatus, setInstallStatus] = useState("idle");
  const operationRef = useRef(false);

  const runRelaunch = useCallback(async () => {
    setInstallStatus("restarting");
    try {
      await relaunch();
      return true;
    } catch {
      setInstallStatus("restart-error");
      return false;
    }
  }, []);

  const restartToApply = useCallback(async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    const succeeded = await runRelaunch();
    if (!succeeded) operationRef.current = false;
  }, [runRelaunch]);

  const install = useCallback(
    async (update) => {
      if (!update || operationRef.current) return;

      operationRef.current = true;
      setInstallStatus("installing");
      try {
        await update.downloadAndInstall(undefined, { timeout: UPDATE_DOWNLOAD_TIMEOUT_MS });
      } catch {
        operationRef.current = false;
        setInstallStatus("install-error");
        return;
      }

      const succeeded = await runRelaunch();
      if (!succeeded) operationRef.current = false;
    },
    [runRelaunch]
  );

  const resetInstall = useCallback(() => {
    if (operationRef.current) return;
    setInstallStatus("idle");
  }, []);

  return { installStatus, install, restartToApply, resetInstall };
}
