import { useEffect, useLayoutEffect, useRef } from "react";
import { isTauri } from "../ipc/env.js";

export function historyPerformanceHarnessOptionsFromSearch(search) {
  const params = new URLSearchParams(search);
  const enabled = params.get("historyPerf") === "240m";
  return {
    enabled,
    fullVisual: enabled && params.get("historyPerfFullVisual") === "1",
  };
}

export function startHistoryPerformanceHarnessController({
  start,
  intake,
  fullVisual,
  publishAudio,
  requestKeys,
}) {
  intake.reset();
  return start({
    intake,
    fullVisual,
    publishAudio,
    ...requestKeys,
  });
}

export function updateHistoryPerformanceHarnessController(controller, requestKeys) {
  controller?.updateRequestKeys(requestKeys);
}

export function useHistoryPerformanceHarness({ analysisRequests, intakeRef, setAudio }) {
  const historyPerformanceControllerRef = useRef(null);
  const historyPerformanceRequestKeysRef = useRef(null);
  useLayoutEffect(() => {
    historyPerformanceRequestKeysRef.current = {
      spectrumKeys: analysisRequests.spectrum.map((request) => request.key),
      vectorscopeKeys: analysisRequests.vectorscope.map((request) => request.key),
      stereoMapKeys: analysisRequests.stereoMap.map((request) => request.key),
    };
  }, [analysisRequests]);

  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const options = historyPerformanceHarnessOptionsFromSearch(window.location.search);
    if (!options.enabled) return undefined;
    // `npm run dev` is browser-only and has no Tauri capture. Keep this harness out of the
    // desktop runtime so a query parameter can never compete with the real audio engine.
    if (isTauri()) return undefined;
    let disposed = false;
    void import("./historyPerformanceHarness.js").then(({ startHistoryPerformanceHarness }) => {
      if (disposed) return;
      historyPerformanceControllerRef.current = startHistoryPerformanceHarnessController({
        start: startHistoryPerformanceHarness,
        intake: intakeRef.current,
        fullVisual: options.fullVisual,
        requestKeys: historyPerformanceRequestKeysRef.current,
        publishAudio: (nextAudio) => setAudio((current) => ({ ...current, ...nextAudio })),
      });
    });
    return () => {
      disposed = true;
      historyPerformanceControllerRef.current?.cancel();
      historyPerformanceControllerRef.current = null;
    };
  }, [intakeRef, setAudio]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const options = historyPerformanceHarnessOptionsFromSearch(window.location.search);
    if (!options.enabled || isTauri()) return;
    updateHistoryPerformanceHarnessController(
      historyPerformanceControllerRef.current,
      historyPerformanceRequestKeysRef.current
    );
  }, [analysisRequests]);
}
