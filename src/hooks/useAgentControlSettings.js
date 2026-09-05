import { useCallback, useEffect, useRef, useState } from "react";
import { agentControlStatusCommand, setAgentControlEnabledCommand } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";

export function useAgentControlSettings({ settingsOpen }) {
  const [agentControlStatus, setAgentControlStatus] = useState(undefined);
  const [agentControlBusy, setAgentControlBusy] = useState(false);
  // The setter has to return the status it settled on, and a functional state updater cannot
  // supply it: called from an async catch block it runs after the call has already returned, so
  // a value captured inside it is still undefined by then. The ref carries the same value
  // synchronously.
  const statusRef = useRef(undefined);

  const applyStatus = useCallback((next) => {
    statusRef.current = next;
    setAgentControlStatus(next);
    return next;
  }, []);

  useEffect(() => {
    if (!settingsOpen || !isTauri()) return;
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) applyStatus(null);
    });
    agentControlStatusCommand()
      .then((nextStatus) => {
        if (!disposed) applyStatus(nextStatus);
      })
      .catch(() => {
        if (!disposed) {
          applyStatus({
            supported: false,
            enabled: false,
            cliInstalled: false,
            onPath: false,
            message: "Agent Control is unavailable.",
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [applyStatus, settingsOpen]);

  const setAgentControlEnabled = useCallback(
    async (enabled) => {
      if (!isTauri()) return undefined;
      setAgentControlBusy(true);
      try {
        return applyStatus(await setAgentControlEnabledCommand(enabled));
      } catch (_) {
        // Leave `enabled` where it was: the endpoint did not move, and a switch that flips on a
        // failed call tells the user they granted something they did not.
        const current = statusRef.current;
        return applyStatus({
          ...(current ?? {}),
          supported: current?.supported ?? true,
          enabled: current?.enabled ?? false,
          cliInstalled: current?.cliInstalled ?? false,
          onPath: current?.onPath ?? false,
          message: "Agent Control could not be changed.",
        });
      } finally {
        setAgentControlBusy(false);
      }
    },
    [applyStatus]
  );

  return { agentControlStatus, agentControlBusy, setAgentControlEnabled };
}
