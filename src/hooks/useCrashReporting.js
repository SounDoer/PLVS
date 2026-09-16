import { useCallback, useEffect, useState } from "react";
import { logFrontendError, readPendingCrashReport } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";

function describeReason(reason) {
  try {
    if (reason instanceof Error) {
      const summary = `${reason.name || "Error"}: ${reason.message || "Unknown error"}`;
      return reason.stack ? `${summary}\n${reason.stack}` : summary;
    }
    if (typeof reason === "string") return reason || "Unknown error";
    const json = JSON.stringify(reason);
    return json === undefined ? String(reason) : json;
  } catch {
    return "Unserializable error value";
  }
}

function forwardOrdinaryError(kind, reason) {
  const message = `[${kind}] ${describeReason(reason)}`;
  if (!isTauri()) {
    console.error(message);
    return;
  }
  Promise.resolve(logFrontendError(message)).catch(() => {
    // A logging failure must not produce another global error or rejection loop.
  });
}

export function useCrashReporting({ promptEnabled = true } = {}) {
  const [pendingReport, setPendingReport] = useState(null);

  useEffect(() => {
    if (!promptEnabled || !isTauri()) {
      return undefined;
    }
    let cancelled = false;
    Promise.resolve(readPendingCrashReport())
      .then((report) => {
        if (!cancelled) setPendingReport(report ?? null);
      })
      .catch((error) => {
        console.error("Unable to read saved crash report", error);
      });
    return () => {
      cancelled = true;
    };
  }, [promptEnabled]);

  useEffect(() => {
    const onError = (event) => {
      forwardOrdinaryError("window.error", event.error ?? event.message);
    };
    const onUnhandledRejection = (event) => {
      forwardOrdinaryError("unhandledrejection", event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  const dismissPending = useCallback(() => setPendingReport(null), []);
  return { pendingReport: promptEnabled ? pendingReport : null, dismissPending };
}
