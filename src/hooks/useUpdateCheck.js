import { useCallback, useEffect, useRef, useState } from "react";
import { checkForUpdate } from "@/lib/updateCheck.js";

export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function useUpdateCheck(currentVersion, intervalMs = UPDATE_CHECK_INTERVAL_MS) {
  const [updateInfo, setUpdateInfo] = useState({ status: "checking" });
  const mountedRef = useRef(false);
  const inFlightRef = useRef(false);

  const refreshUpdateCheck = useCallback(async () => {
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    setUpdateInfo((current) => ({ ...current, status: "checking" }));

    try {
      const info = await checkForUpdate(currentVersion);
      if (mountedRef.current) {
        setUpdateInfo(info ? { ...info, status: "ok" } : { status: "unavailable" });
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [currentVersion]);

  useEffect(() => {
    mountedRef.current = true;
    refreshUpdateCheck();

    if (!intervalMs) {
      return () => {
        mountedRef.current = false;
      };
    }

    const intervalId = window.setInterval(refreshUpdateCheck, intervalMs);
    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
    };
  }, [intervalMs, refreshUpdateCheck]);

  return {
    updateInfo,
    isCheckingForUpdate: updateInfo.status === "checking",
    refreshUpdateCheck,
  };
}
