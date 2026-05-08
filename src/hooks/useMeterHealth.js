import { useEffect, useState } from "react";
import { getEngineState } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { onEngineBackpressure, onEngineStateChanged } from "../ipc/events.js";

/**
 * Meter health state for status badge. Intended to be user-facing and conservative:
 * - OK only when running
 * - Stopped when not running
 * - Error on engine error
 *
 * @returns {"ok"|"degraded"|"stopped"|"error"}
 */
export function useMeterHealth() {
  const [health, setHealth] = useState("stopped");

  useEffect(() => {
    if (!isTauri()) {
      return undefined;
    }
    let u = () => {};
    let u2 = () => {};
    let off = false;
    let degradeTimer = 0;
    void (async () => {
      try {
        const s = await getEngineState();
        if (!off) setHealth(s === "running" ? "ok" : "stopped");
        const un = await onEngineStateChanged((p) => {
          if (p.state === "running") return setHealth("ok");
          if (p.state === "error") return setHealth("error");
          return setHealth("stopped");
        });
        u = un;

        const un2 = await onEngineBackpressure((p) => {
          if (!p || typeof p !== "object") return;
          if (typeof p.droppedChunks !== "number") return;
          if (p.droppedChunks <= 0) return;
          setHealth((h) => (h === "error" ? h : "degraded"));
          if (degradeTimer) window.clearTimeout(degradeTimer);
          degradeTimer = window.setTimeout(() => {
            setHealth((h) => (h === "degraded" ? "ok" : h));
          }, 3000);
        });
        u2 = un2;
      } catch {
        if (!off) setHealth("stopped");
      }
    })();
    return () => {
      off = true;
      if (degradeTimer) window.clearTimeout(degradeTimer);
      u();
      u2();
    };
  }, []);

  return health;
}

