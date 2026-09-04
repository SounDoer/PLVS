import { useRef, useState } from "react";

function transitionError(lifecycle) {
  const error = new Error(`LIVE transport is ${lifecycle}.`);
  error.code = "transitionInProgress";
  return error;
}

/**
 * Owns requested capture state plus the acknowledged LIVE lifecycle. GUI callers may ignore the
 * returned promises; App Control awaits them so success means the engine accepted the transition.
 */
export function useCaptureTransport({ display, getLiveIntake }) {
  const [running, setRunning] = useState(false);
  const [lifecycle, setLifecycle] = useState("stopped");
  const [resolvedDeviceId, setResolvedDeviceId] = useState(null);
  const [startedAt, setStartedAt] = useState(null);
  const [lastError, setLastError] = useState(null);
  const lifecycleRef = useRef("stopped");
  const pendingStartRef = useRef(null);
  const pendingStopRef = useRef(null);

  const publishLifecycle = (next) => {
    lifecycleRef.current = next;
    setLifecycle(next);
  };

  const startLiveForControl = () => {
    if (lifecycleRef.current === "running") return Promise.resolve();
    if (lifecycleRef.current === "starting" || lifecycleRef.current === "stopping") {
      return Promise.reject(transitionError(lifecycleRef.current));
    }
    display.clearNotice();
    getLiveIntake().beginCaptureSession();
    setLastError(null);
    publishLifecycle("starting");
    setRunning(true);
    display.clock.startTimer();
    display.setShowClock(true);
    return new Promise((resolve, reject) => {
      pendingStartRef.current = { resolve, reject };
    });
  };

  const stopLiveForControl = () => {
    if (lifecycleRef.current === "stopped") return Promise.resolve();
    if (lifecycleRef.current === "starting" || lifecycleRef.current === "stopping") {
      return Promise.reject(transitionError(lifecycleRef.current));
    }
    display.clearNotice();
    publishLifecycle("stopping");
    setRunning(false);
    display.setSelectedOffset(-1);
    display.clock.stopTimer();
    return new Promise((resolve, reject) => {
      pendingStopRef.current = { resolve, reject };
    });
  };

  const markStarted = ({ resolvedDeviceId: nextDeviceId = null } = {}) => {
    setResolvedDeviceId(nextDeviceId);
    setStartedAt(Date.now());
    setLastError(null);
    publishLifecycle("running");
    const pending = pendingStartRef.current;
    pendingStartRef.current = null;
    pending?.resolve();
  };

  const markStartFailed = (error) => {
    setRunning(false);
    setResolvedDeviceId(null);
    setStartedAt(null);
    setLastError({ message: error?.message || String(error) });
    publishLifecycle("error");
    const pending = pendingStartRef.current;
    pendingStartRef.current = null;
    pending?.reject(error);
  };

  const markStopped = () => {
    setRunning(false);
    setResolvedDeviceId(null);
    publishLifecycle("stopped");
    const pending = pendingStopRef.current;
    pendingStopRef.current = null;
    pending?.resolve();
  };

  const markStopFailed = (error) => {
    setLastError({ message: error?.message || String(error) });
    publishLifecycle("error");
    const pending = pendingStopRef.current;
    pendingStopRef.current = null;
    pending?.reject(error);
  };

  const halt = (error) => {
    if (error) markStartFailed(error);
    else markStopped();
  };

  const startLive = () => {
    void startLiveForControl().catch(() => {});
  };

  const stopLive = () => {
    if (lifecycleRef.current === "starting") {
      const pending = pendingStartRef.current;
      pendingStartRef.current = null;
      pending?.reject(transitionError("starting"));
      display.clearNotice();
      publishLifecycle("stopping");
      setRunning(false);
      display.setSelectedOffset(-1);
      display.clock.stopTimer();
      return;
    }
    void stopLiveForControl().catch(() => {});
  };

  return {
    running,
    lifecycle,
    resolvedDeviceId,
    startedAt,
    lastError,
    halt,
    startLive,
    stopLive,
    startLiveForControl,
    stopLiveForControl,
    markStarted,
    markStartFailed,
    markStopped,
    markStopFailed,
  };
}
