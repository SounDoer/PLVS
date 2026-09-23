import { useCallback, useEffect, useRef, useState } from "react";
import { checkForUpdate } from "@/lib/updateCheck.js";
import { useCoordinatorRole } from "../lib/runtimeRole.js";

export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

export function useUpdateCheck(intervalMs = UPDATE_CHECK_INTERVAL_MS) {
  const isCoordinator = useCoordinatorRole();
  const [updateInfo, setUpdateInfo] = useState({
    status: isCoordinator ? "checking" : "unavailable",
  });
  const mountedRef = useRef(false);
  const inFlightRef = useRef(false);

  const refreshUpdateCheck = useCallback(async () => {
    if (!isCoordinator || inFlightRef.current) return;

    inFlightRef.current = true;
    setUpdateInfo((current) => ({ ...current, status: "checking" }));

    try {
      const info = await checkForUpdate();
      if (mountedRef.current) {
        setUpdateInfo(info ? { ...info, status: "ok" } : { status: "unavailable" });
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [isCoordinator]);

  useEffect(() => {
    mountedRef.current = true;
    if (!isCoordinator) {
      setUpdateInfo({ status: "unavailable" });
      return () => {
        mountedRef.current = false;
      };
    }
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
  }, [intervalMs, refreshUpdateCheck, isCoordinator]);

  return {
    updateInfo,
    isCheckingForUpdate: updateInfo.status === "checking",
    refreshUpdateCheck,
  };
}
