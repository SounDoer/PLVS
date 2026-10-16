import { normalizeUpdatePreferences } from "./updatePreferences.js";
import { RELEASES_URL } from "./updateCheck.js";
import { DEVELOPMENT_UPDATE } from "../dev/developmentEventFixtureData.js";

/** One owner for update decisions. Dependencies keep native handoff and race tests deterministic. */
export function createUpdateController({
  invoke,
  prepare,
  commit,
  abort,
  openExternal,
  relaunch = async () => {},
}) {
  const listeners = new Set();
  let state = {
    revision: 0,
    initialized: false,
    enabled: false,
    installationSupported: false,
    candidate: null,
    ready: null,
    details: null,
    checkStatus: "idle",
    installStatus: "idle",
    downloadProgress: null,
    downloading: false,
    error: null,
  };
  let preferences = normalizeUpdatePreferences(null);
  let generation = 0;
  let checking = false;
  let transfer = null;
  let confirming = false;
  let startupConsumed = false;
  let available = false;
  let lifetime = 0;
  let presentation = 0;
  const emit = (patch) => {
    state = { ...state, ...patch, revision: state.revision + 1 };
    listeners.forEach((listener) => listener());
  };
  const busy = () => confirming;

  /** @param {{ eligible?: boolean | (() => boolean) }} [options] */
  async function initialize({ eligible = () => false } = {}) {
    const requestLifetime = lifetime;
    try {
      const status = await invoke("update_status");
      if (requestLifetime !== lifetime) return;
      available = status.enabled === true;
      emit({
        initialized: true,
        enabled: available,
        installationSupported: status.installationSupported,
        ready: status.ready,
        error: status.error ?? (status.attempt?.phase === "failed" ? status.attempt.error : null),
      });
      if (!startupConsumed) {
        startupConsumed = true;
        if (
          (typeof eligible === "function" ? eligible() : eligible) &&
          status.freshSession &&
          status.ready &&
          preferences.autoDownload &&
          !(
            status.attempt?.phase === "failed" &&
            (!status.attempt.version || status.attempt.version === status.ready.version)
          ) &&
          available &&
          status.installationSupported
        ) {
          openDetails(status.ready, "startup");
        }
      }
    } catch (error) {
      if (requestLifetime !== lifetime) return;
      emit({ initialized: true, error: String(error) });
    }
  }

  async function setPreferences(value) {
    const next = normalizeUpdatePreferences(value);
    const revoked =
      (preferences.autoCheck && !next.autoCheck) ||
      (preferences.autoDownload && !next.autoDownload);
    preferences = next;
    if (!revoked || !available) return;
    generation += 1;
    // Explicitly confirmed manual work is independent of automatic preferences.
    if (confirming || transfer?.automatic === false) return;
    try {
      await invoke("update_cancel");
      emit({ ready: null, downloading: false, checkStatus: "idle" });
    } catch (error) {
      emit({ error: String(error) });
    }
  }

  async function download(target, automatic) {
    if (transfer || !available || !state.installationSupported) return null;
    if (automatic && !preferences.autoDownload) return null;
    const job = { automatic, generation };
    transfer = job;
    emit({ downloading: true, downloadProgress: null, error: null });
    try {
      const ready = await invoke("update_download", { candidateId: target.id, automatic });
      if (automatic && (job.generation !== generation || !preferences.autoDownload)) return null;
      if (ready) emit({ ready });
      return ready;
    } catch (error) {
      if (!automatic || job.generation === generation) emit({ error: String(error) });
      if (!automatic) throw error;
      return null;
    } finally {
      if (transfer === job) {
        transfer = null;
        emit({ downloading: false });
      }
    }
  }

  async function check(automatic = false) {
    if (!available || checking || (automatic && !preferences.autoCheck)) return;
    const requestGeneration = generation;
    checking = true;
    emit({ checkStatus: "checking" });
    try {
      const candidate = await invoke("update_check", { automatic });
      if (automatic && (requestGeneration !== generation || !preferences.autoCheck)) return;
      emit({ candidate, checkStatus: "ok" });
      // One attempt per scheduled check. Failed transfers wait for Check Now or the next interval.
      if (
        automatic &&
        preferences.autoDownload &&
        candidate &&
        candidate.version !== state.ready?.version &&
        !state.details &&
        !confirming
      ) {
        await download(candidate, true);
      }
    } catch (error) {
      if (!automatic || requestGeneration === generation) {
        emit({ checkStatus: "unavailable", error: String(error) });
      }
    } finally {
      checking = false;
    }
  }

  function openDetails(
    target = state.ready ?? state.candidate ?? state.details?.target,
    origin = "manual"
  ) {
    if (!available || !target || busy()) return;
    if (state.details) {
      emit({ details: { ...state.details, presentation: ++presentation } });
      return;
    }
    // Freeze the descriptor and whether it was a cached package. A replacement never changes it.
    emit({
      details: {
        target,
        origin,
        staged: target.id === state.ready?.id,
        presentation: ++presentation,
      },
      installStatus: "idle",
      error: null,
    });
  }

  function dismissDetails() {
    if (!busy()) emit({ details: null, installStatus: "idle", error: null });
  }

  async function confirmInstall(expectedId = state.details?.target.id) {
    const details = state.details;
    if (busy() || !available || !details || details.target.id !== expectedId) return;
    if (details.origin === "fixture") {
      emit({ error: "This development preview cannot install an update." });
      return;
    }
    if (!state.installationSupported) {
      // The release page includes the Portable ZIP; this path never invokes an installer.
      await openExternal(RELEASES_URL);
      return;
    }
    if (transfer) {
      emit({ error: "An update is downloading. Try again when it finishes." });
      return;
    }
    confirming = true;
    emit({ installStatus: "installing", error: null });
    let token;
    let operation;
    let commitAttempted = false;
    try {
      const ready = details.staged ? details.target : await download(details.target, false);
      if (!ready) throw new Error("This update is no longer ready. Check again.");
      // Startup peer eligibility is checked under the native entry gate BEFORE stopping capture.
      token = await invoke("update_prepare_install", {
        packageId: ready.id,
        startup: details.origin === "startup",
      });
      operation = await prepare();
      commitAttempted = true;
      await commit(operation);
      emit({ installStatus: "restarting" });
      await invoke("update_commit_install", { token });
    } catch (error) {
      if (token) await invoke("update_abort_install", { token }).catch(() => {});
      if (operation) await abort(operation).catch(() => {});
      // A partial commit can already have closed peers. Ordinary relaunch restores the saved set.
      if (commitAttempted) await relaunch().catch(() => {});
      confirming = false;
      emit({ installStatus: "install-error", error: String(error) });
    }
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    initialize,
    openFixture: (fixtureId) => {
      if (busy()) return;
      emit({
        details: {
          origin: "fixture",
          staged: false,
          target: {
            id: fixtureId,
            version: DEVELOPMENT_UPDATE.update.version,
            manifest: { notes: DEVELOPMENT_UPDATE.releaseNotes },
          },
        },
        installStatus: "idle",
        error: null,
      });
    },
    setPreferences,
    check,
    openDetails,
    dismissDetails,
    confirmInstall,
    progress: ({ received, total }) => {
      if (transfer) emit({ downloadProgress: total > 0 ? Math.min(1, received / total) : null });
    },
    deactivate: () => {
      available = false;
      generation += 1;
      lifetime += 1;
    },
  };
}
