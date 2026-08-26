import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_PULSE_MS } from "../math/axisInteractionMath";

// Axis rails light up while their range is being changed, whether the gesture landed on the rail
// itself or out in the plot area. A wheel tick has no end event, so `pulse` self-clears after
// ACTIVE_PULSE_MS; a drag does have one, so it `hold`s the highlight until `release`.
//
// `idle` is what the highlight falls back to. It is a bare boolean for panels with one editable
// axis, and an {x, y} pair for the spectrum, where a single gesture lights one axis or the other.
// Pass an object from module scope, not a literal -- a fresh identity each render would rebuild
// every callback below.
export function useAxisActivePulse(idle = false) {
  const timerRef = useRef(null);
  const [active, setActive] = useState(idle);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const pulse = useCallback(
    (value = true) => {
      setActive(value);
      clearTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        setActive(idle);
      }, ACTIVE_PULSE_MS);
    },
    [clearTimer, idle]
  );

  const hold = useCallback(
    (value = true) => {
      clearTimer();
      setActive(value);
    },
    [clearTimer]
  );

  const release = useCallback(() => {
    clearTimer();
    setActive(idle);
  }, [clearTimer, idle]);

  return { active, pulse, hold, release };
}
