import { useCallback, useState } from "react";
import { enterDock, exitDock } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";

function normalizeDockState(raw) {
  const edge = raw?.edge === "top" ? "top" : "bottom";
  return { enabled: raw?.enabled === true, edge };
}

/**
 * Dock window-form state. Rust owns geometry + the persisted dockState key;
 * this hook mirrors it for rendering and drives enter/exit transitions.
 * Attribute restores (decorations / always-on-top) are passed by the caller so
 * stored user settings are never rewritten by the dock override.
 */
export function useDockMode() {
  const [dock, setDock] = useState(() =>
    normalizeDockState(
      typeof window !== "undefined" ? window.__PLVS_INITIAL_STATE__?.dockState : undefined
    )
  );

  const enterDockMode = useCallback(async (edge) => {
    if (!isTauri()) return;
    await enterDock(edge);
    setDock({ enabled: true, edge });
  }, []);

  const exitDockMode = useCallback(async ({ decorations, alwaysOnTop }) => {
    if (!isTauri()) return;
    await exitDock({ decorations, alwaysOnTop });
    setDock((prev) => ({ ...prev, enabled: false }));
  }, []);

  return { dockEnabled: dock.enabled, dockEdge: dock.edge, enterDockMode, exitDockMode };
}
