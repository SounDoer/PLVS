import { useCallback, useEffect, useRef, useState } from "react";

/// How long a status line stays up. Long enough to read a full sentence -- the import failures
/// carry actionable copy ("This is a Theme file. Import it from the Theme row.") -- and short
/// enough that a stale confirmation is not still sitting there when the user looks back.
export const STATUS_DISMISS_MS = 6000;

/**
 * A status string that clears itself.
 *
 * Drop-in for the `useState("")` these hooks used to hold: same tuple, same empty default. The
 * difference is that a non-empty value starts a timer, and setting a new one (including the `""`
 * every action writes before it starts work) cancels the pending clear rather than racing it.
 *
 * @param {number} [dismissMs]
 * @returns {[string, (next: string) => void]}
 */
export function useTransientStatus(dismissMs = STATUS_DISMISS_MS) {
  const [status, setStatusState] = useState("");
  const timerRef = useRef(0);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const setStatus = useCallback(
    (next) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = 0;
      }
      setStatusState(next);
      if (!next) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = 0;
        setStatusState("");
      }, dismissMs);
    },
    [dismissMs]
  );

  return [status, setStatus];
}
