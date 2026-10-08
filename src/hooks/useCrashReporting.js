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

/**
 * @param {string} kind
 */
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

/** @param {{ promptEnabled?: boolean }} [options] */
export function useCrashReporting({ promptEnabled = true } = {}) {
  const [pendingReport, setPendingReport] = useState(null);
  const [developmentFixtureId, setDevelopmentFixtureId] = useState(null);

  useEffect(() => {
    if (!promptEnabled || !isTauri()) {
      return undefined;
    }
    let cancelled = false;
    Promise.resolve(readPendingCrashReport())
      .then((report) => {
        if (!cancelled) {
          setDevelopmentFixtureId(null);
          setPendingReport(report ?? null);
        }
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

  const dismissPending = useCallback(() => {
    setDevelopmentFixtureId(null);
    setPendingReport(null);
  }, []);
  const developmentFixture = {
    establish(fixtureId, report) {
      setDevelopmentFixtureId(fixtureId);
      setPendingReport(report);
    },
    matches(fixtureId) {
      return pendingReport !== null && developmentFixtureId === fixtureId;
    },
    reset(fixtureId) {
      if (developmentFixtureId !== fixtureId) return;
      setDevelopmentFixtureId(null);
      setPendingReport(null);
    },
  };
  return {
    pendingReport: promptEnabled || developmentFixtureId ? pendingReport : null,
    dismissPending,
    developmentFixture,
  };
}
