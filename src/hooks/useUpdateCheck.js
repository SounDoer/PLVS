import { useCallback, useEffect, useRef, useState } from "react";
import { checkForUpdate } from "@/lib/updateCheck.js";
import { useCoordinatorRole } from "../lib/runtimeRole.js";

export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** Automatic scheduling is separate from the explicit Check Now action. */
export function useUpdateCheck(intervalMs = UPDATE_CHECK_INTERVAL_MS, automatic = false) {
  const isCoordinator = useCoordinatorRole();
  const [rawUpdateInfo, setUpdateInfo] = useState(
    /** @type {{ status: string, [key: string]: any }} */ ({ status: "idle" })
  );
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const requestRef = useRef(null);

  const runUpdateCheck = useCallback(
    async (automaticRequest = false) => {
      if (!isCoordinator || requestRef.current) return;
      const request = { generation: generationRef.current };
      requestRef.current = request;
      setUpdateInfo((current) => ({ ...current, status: "checking", automaticRequest }));
      try {
        const info = await checkForUpdate();
        if (mountedRef.current && request.generation === generationRef.current) {
          setUpdateInfo(info ? { ...info, status: "ok" } : { status: "unavailable" });
        } else {
          // Plugin resources belong to this request, even when its result is no longer wanted.
          try {
            await info?.update?.close?.();
          } catch {
            // The native resource may already have gone away during shutdown.
          }
        }
      } finally {
        if (requestRef.current === request) requestRef.current = null;
      }
    },
    [isCoordinator]
  );

  useEffect(() => {
    mountedRef.current = true;
    let intervalId;
    if (isCoordinator && automatic) {
      void runUpdateCheck(true);
      if (intervalMs) intervalId = window.setInterval(() => void runUpdateCheck(true), intervalMs);
    }
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      requestRef.current = null;
      window.clearInterval(intervalId);
    };
  }, [intervalMs, runUpdateCheck, isCoordinator, automatic]);

  const refreshUpdateCheck = useCallback(() => runUpdateCheck(false), [runUpdateCheck]);
  const updateInfo =
    rawUpdateInfo.status === "checking" &&
    (!isCoordinator || (rawUpdateInfo.automaticRequest && !automatic))
      ? { ...rawUpdateInfo, status: "idle" }
      : rawUpdateInfo;
  return {
    updateInfo,
    isCheckingForUpdate: updateInfo.status === "checking",
    refreshUpdateCheck,
  };
}
