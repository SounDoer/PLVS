import { useCallback, useEffect, useMemo, useRef } from "react";
import { getUiFrameDiagnostics } from "../ipc/commands.js";
import {
  boundedMainThreadStall,
  createDevelopmentPerformanceProbe,
} from "./developmentPerformanceProbe.js";

export function useDevelopmentPerformance(enabled) {
  const probeRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const probe = createDevelopmentPerformanceProbe();
    probeRef.current = probe;
    probe.start();
    return () => {
      probe.stop();
      if (probeRef.current === probe) probeRef.current = null;
    };
  }, [enabled]);

  const inspect = useCallback(async () => {
    if (!enabled || !probeRef.current)
      throw new Error("Development performance probe unavailable.");
    const native = await getUiFrameDiagnostics();
    return {
      sampledAt: new Date().toISOString(),
      native,
      renderer: probeRef.current.snapshot(),
    };
  }, [enabled]);

  const stall = useCallback(
    async (milliseconds) => {
      if (!enabled) throw new Error("Development performance probe unavailable.");
      return boundedMainThreadStall(milliseconds);
    },
    [enabled]
  );

  return useMemo(() => ({ enabled, inspect, stall }), [enabled, inspect, stall]);
}
