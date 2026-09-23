import { useCallback, useRef, useState } from "react";
import { relaunch } from "@tauri-apps/plugin-process";
import { useCoordinatorRole } from "../lib/runtimeRole.js";

const UPDATE_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

function knownTotal(contentLength) {
  return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
}

/**
 * Drives the download + install step for an Update handle returned by
 * checkForUpdate(), separate from the periodic check itself.
 *
 * `downloadProgress` stays null while the updater has not reported a total
 * size. A 0..1 fraction is published only when the integer percent changes.
 */
export function useApplyUpdate() {
  const isCoordinator = useCoordinatorRole();
  const [installStatus, setInstallStatus] = useState("idle");
  const [downloadProgress, setDownloadProgress] = useState(null);
  const operationRef = useRef(false);
  const progressRef = useRef({ received: 0, total: null, publishedPercent: -1 });

  const clearProgress = useCallback(() => {
    progressRef.current = { received: 0, total: null, publishedPercent: -1 };
    setDownloadProgress(null);
  }, []);

  const onDownloadEvent = useCallback((event) => {
    const state = progressRef.current;
    if (event?.event === "Started") {
      state.received = 0;
      state.total = knownTotal(event.data?.contentLength);
      state.publishedPercent = -1;
      if (state.total == null) {
        setDownloadProgress(null);
        return;
      }
      state.publishedPercent = 0;
      setDownloadProgress(0);
      return;
    }

    if (event?.event === "Progress") {
      const chunk = event.data?.chunkLength;
      if (!Number.isFinite(chunk) || chunk <= 0 || state.total == null) return;
      state.received += chunk;
      const fraction = Math.min(1, state.received / state.total);
      const percent = Math.round(fraction * 100);
      if (percent === state.publishedPercent) return;
      state.publishedPercent = percent;
      setDownloadProgress(fraction);
      return;
    }

    if (event?.event === "Finished" && state.total != null) {
      state.publishedPercent = 100;
      setDownloadProgress(1);
    }
  }, []);

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
    if (!isCoordinator || operationRef.current) return;
    operationRef.current = true;
    const succeeded = await runRelaunch();
    if (!succeeded) operationRef.current = false;
  }, [runRelaunch, isCoordinator]);

  const install = useCallback(
    async (update) => {
      if (!isCoordinator || !update || operationRef.current) return;

      operationRef.current = true;
      clearProgress();
      setInstallStatus("installing");
      try {
        await update.downloadAndInstall(onDownloadEvent, { timeout: UPDATE_DOWNLOAD_TIMEOUT_MS });
      } catch {
        operationRef.current = false;
        clearProgress();
        setInstallStatus("install-error");
        return;
      }

      const succeeded = await runRelaunch();
      if (!succeeded) operationRef.current = false;
    },
    [clearProgress, onDownloadEvent, runRelaunch, isCoordinator]
  );

  const resetInstall = useCallback(() => {
    if (operationRef.current) return;
    clearProgress();
    setInstallStatus("idle");
  }, [clearProgress]);

  return { installStatus, downloadProgress, install, restartToApply, resetInstall };
}
