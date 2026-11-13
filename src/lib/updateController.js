import { normalizeUpdatePreferences } from "./updatePreferences.js";
import {
  DEVELOPMENT_UPDATE,
  TUTORIAL_UPDATE_NOTES,
  tutorialUpdateVersion,
} from "../dev/developmentEventFixtureData.js";

export const RELEASES_URL = "https://github.com/SounDoer/PLVS/releases/latest";
const RELEASE_TAGS_URL = "https://github.com/SounDoer/PLVS/releases/tag";
export const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** Public stable updates have exact immutable Release pages; fixtures and malformed values do not. */
export function releaseUrlForVersion(version) {
  return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version)
    ? `${RELEASE_TAGS_URL}/v${version}`
    : null;
}

/**
 * The newest known update. A later feed check supersedes an older staged package, so the staged
 * version must not hide it.
 */
export function newestUpdateTarget({ ready, candidate, details }) {
  if (ready && candidate && candidate.version !== ready.version) return candidate;
  return ready ?? candidate ?? details?.target ?? null;
}

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
    installationUnavailableReason: null,
    downloadError: null,
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
  let failedAttempt = null;
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
      failedAttempt = status.attempt?.phase === "failed" ? status.attempt : null;
      emit({
        initialized: true,
        enabled: available,
        installationSupported: status.installationSupported,
        installationUnavailableReason: status.installationUnavailableReason ?? null,
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
      emit({ ready: null, downloading: false, downloadError: null, checkStatus: "idle" });
    } catch (error) {
      emit({ error: String(error) });
    }
  }

  async function download(target, automatic) {
    if (target?.preview || transfer || !available || !state.installationSupported) return null;
    if (automatic && !preferences.autoDownload) return null;
    const job = { automatic, generation };
    transfer = job;
    emit({ downloading: true, downloadProgress: null, downloadError: null, error: null });
    try {
      const ready = await invoke("update_download", { candidateId: target.id, automatic });
      if (automatic && (job.generation !== generation || !preferences.autoDownload)) return null;
      if (ready) {
        const details = state.details;
        const stagedDetails =
          details && details.target.version === ready.version
            ? { ...details, target: ready, staged: true }
            : details;
        emit({ ready, details: stagedDetails, error: null });
      }
      return ready;
    } catch (error) {
      if (!automatic || job.generation === generation)
        emit({ error: String(error), downloadError: String(error) });
      if (!automatic) throw error;
      return null;
    } finally {
      if (transfer === job) {
        transfer = null;
        emit({ downloading: false, downloadProgress: null });
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
      // Details frozen on a version that is not staged keep it. Details offering the staged package
      // follow a newer version, because staging it replaces and removes that older package.
      const details = state.details;
      const supersedable =
        !details ||
        (details.origin !== "fixture" &&
          details.staged &&
          details.target.id === state.ready?.id &&
          !transfer);
      // One attempt per check. Failed transfers wait for Check or the next interval.
      if (
        preferences.autoDownload &&
        candidate &&
        candidate.version !== state.ready?.version &&
        supersedable &&
        !confirming
      ) {
        if (details) {
          // Until verification promotes it, the newer target shows download progress and blocks
          // confirmation, so the older package cannot be installed while it is being replaced.
          emit({
            details: { ...details, target: candidate, staged: false },
            error: failedAttemptError(candidate),
          });
        }
        await download(candidate, true);
      }
    } catch {
      if (!automatic || requestGeneration === generation) {
        // Feed availability is independent of download/installation errors. Keeping it in
        // checkStatus also lets a successful retry resolve it without erasing recovery errors.
        emit({ checkStatus: "unavailable" });
      }
    } finally {
      checking = false;
    }
  }

  function failedAttemptError(target) {
    return failedAttempt && (!failedAttempt.version || failedAttempt.version === target.version)
      ? failedAttempt.error
      : null;
  }

  function openDetails(target = newestUpdateTarget(state), origin = "manual") {
    if (!available || !target || busy()) return;
    if (state.details) {
      emit({ details: { ...state.details, presentation: ++presentation } });
      return;
    }
    // Freeze the selected version across later checks. Completion of that version's own download
    // may still promote the descriptor to the verified staged package.
    emit({
      details: {
        target,
        // A tutorial preview opens through the real status entry but stays a fixture.
        origin: target.preview ? "fixture" : origin,
        staged: target.id === state.ready?.id,
        presentation: ++presentation,
      },
      installStatus: "idle",
      error: failedAttemptError(target),
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
    // Tutorial recording: an update candidate as a real check would report it, never installable.
    previewUpdate: (fixtureId, currentVersion) => {
      const version = tutorialUpdateVersion(currentVersion);
      if (busy() || !available || !version || state.candidate || state.ready || state.details)
        return false;
      emit({
        candidate: {
          id: fixtureId,
          version,
          manifest: { notes: TUTORIAL_UPDATE_NOTES },
          preview: true,
        },
        checkStatus: "ok",
      });
      return true;
    },
    clearPreview: (fixtureId) => {
      if (busy()) return;
      emit({
        ...(state.candidate?.id === fixtureId ? { candidate: null } : {}),
        ...(state.details?.target.id === fixtureId
          ? { details: null, installStatus: "idle", error: null }
          : {}),
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
