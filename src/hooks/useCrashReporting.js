import { useCallback, useEffect, useEffectEvent, useState } from "react";
import { logFrontendError, readPendingCrashReport } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { useCoordinatorRole } from "../lib/runtimeRole.js";

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
  // Every workbench of an identity shares one pending-report directory, so only the coordinator
  // asks; otherwise each restored workbench would show the same blocking dialog. A workbench that
  // becomes coordinator re-reads, which offers a report left pending by the previous one.
  const isCoordinator = useCoordinatorRole();
  const asking = promptEnabled && isCoordinator;
  // Only launch and coordinator promotion read the pending report. Turning the setting on later
  // must not prompt on the spot for a report saved while it was off or postponed with Later.
  const isPromptEnabled = useEffectEvent(() => promptEnabled);

  useEffect(() => {
    if (!isCoordinator || !isPromptEnabled() || !isTauri()) {
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
  }, [isCoordinator]);

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
    pendingReport: asking || developmentFixtureId ? pendingReport : null,
    dismissPending,
    developmentFixture,
  };
}
