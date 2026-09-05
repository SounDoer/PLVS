import { useCallback, useEffect, useState } from "react";
import { agentControlStatusCommand, setAgentControlEnabledCommand } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";

// Shape every answer the same way, so a caller can read `enabled` off whatever it gets back
// without first checking which path produced it.
const UNAVAILABLE = Object.freeze({
  supported: false,
  enabled: false,
  cliInstalled: false,
  onPath: false,
  message: "Agent Control is unavailable.",
});

export function useAgentControlSettings({ settingsOpen }) {
  const [agentControlStatus, setAgentControlStatus] = useState(undefined);
  const [agentControlBusy, setAgentControlBusy] = useState(false);

  const applyStatus = useCallback((next) => {
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
        if (!disposed) applyStatus({ ...UNAVAILABLE });
      });
    return () => {
      disposed = true;
    };
  }, [applyStatus, settingsOpen]);

  const setAgentControlEnabled = useCallback(
    async (enabled) => {
      // Answer in the usual shape, but leave the status untouched: the panel shows this row only
      // once the status is defined, and outside Tauri there is nothing to show.
      if (!isTauri()) return { ...UNAVAILABLE };
      setAgentControlBusy(true);
      try {
        return applyStatus(await setAgentControlEnabledCommand(enabled));
      } catch (_) {
        // Leave `enabled` where it was: the endpoint did not move, and a switch that flips on a
        // failed call tells the user they granted something they did not. `agentControlStatus` is
        // read from this render's closure, which is the value the user was looking at when they
        // clicked. It can also be undefined (never loaded) or null (still loading), so every
        // field needs its own default, not just the spread.
        return applyStatus({
          ...(agentControlStatus ?? {}),
          supported: agentControlStatus?.supported ?? true,
          enabled: agentControlStatus?.enabled ?? false,
          cliInstalled: agentControlStatus?.cliInstalled ?? false,
          onPath: agentControlStatus?.onPath ?? false,
          message: "Agent Control could not be changed.",
        });
      } finally {
        setAgentControlBusy(false);
      }
    },
    [agentControlStatus, applyStatus]
  );

  return { agentControlStatus, agentControlBusy, setAgentControlEnabled };
}
