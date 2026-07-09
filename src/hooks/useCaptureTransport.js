import { useState } from "react";

/**
 * Owner of the live-capture transport: the `running` flag and the verbs that
 * change it. startLive/stopLive carry the full user-facing orchestration
 * (intake session, clock, notice lifecycle); halt() is state-only for callers that
 * write their own notice/error paths.
 * See docs/superpowers/specs/2026-07-08-c2-app-state-ownership-design.md.
 *
 * Plain (non-memoized) verbs by design: today's inline handlers are recreated
 * per render too and nothing memoizes on them.
 */
export function useCaptureTransport({ display, getLiveIntake }) {
  const [running, setRunning] = useState(false);

  const halt = () => setRunning(false);

  const startLive = () => {
    display.clearNotice();
    getLiveIntake().beginCaptureSession();
    setRunning(true);
    display.clock.startTimer();
    display.setShowClock(true);
  };

  const stopLive = () => {
    display.clearNotice();
    setRunning(false);
    display.setSelectedOffset(-1);
    display.clock.stopTimer();
  };

  return { running, halt, startLive, stopLive };
}
