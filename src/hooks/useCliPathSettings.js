import { useCallback, useEffect, useState } from "react";
import { cliPathStatusCommand, setCliPathEnabledCommand } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";

export function useCliPathSettings({ settingsOpen }) {
  const [cliPathStatus, setCliPathStatus] = useState(undefined);
  const [cliPathBusy, setCliPathBusy] = useState(false);

  useEffect(() => {
    if (!settingsOpen || !isTauri()) return;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) setCliPathStatus(null);
    });
    cliPathStatusCommand()
      .then((nextStatus) => {
        if (!disposed) setCliPathStatus(nextStatus);
      })
      .catch(() => {
        if (!disposed) {
          setCliPathStatus({
            supported: false,
            installed: false,
            onPath: false,
            message: "Command line tools are unavailable.",
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [settingsOpen]);

  const setCliPathEnabled = useCallback(async (enabled) => {
    if (!isTauri()) return;
    setCliPathBusy(true);
    try {
      const nextStatus = await setCliPathEnabledCommand(enabled);
      setCliPathStatus(nextStatus);
    } catch (_) {
      setCliPathStatus((current) => ({
        ...(current ?? {}),
        supported: current?.supported ?? true,
        installed: current?.installed ?? false,
        onPath: current?.onPath ?? false,
        message: "PATH update failed.",
      }));
    } finally {
      setCliPathBusy(false);
    }
  }, []);

  return {
    cliPathStatus,
    cliPathBusy,
    setCliPathEnabled,
  };
}
