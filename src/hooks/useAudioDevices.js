import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { advanceDeviceGeneration, normalizeDeviceInventory } from "../runtime/deviceInventory.js";
import {
  listAudioDevices,
  listCaptureApplications,
  migrateCaptureDeviceId,
  previewAudioDevice,
} from "../ipc/commands.js";
import {
  loadCaptureDeviceId,
  readCaptureDeviceIdFromLocalStorage,
  saveCaptureDeviceId,
} from "../ipc/capturePrefs.js";
import { onDeviceListChanged } from "../ipc/events.js";
import { isTauri } from "../ipc/env.js";
import { isSourceMixId, readSourceMixes } from "../lib/sourceMixes.js";
import { splitChannelSource } from "../lib/channelSources.js";
import { sourceMixesStore } from "../persistence/index.js";

const APPLICATION_REFRESH_INTERVAL_MS = 2_000;

function normalizeCaptureApplications(applications) {
  return (Array.isArray(applications) ? applications : []).flatMap((application) => {
    if (
      typeof application?.id !== "string" ||
      !/^app-[0-9a-f]{32}$/.test(application.id) ||
      typeof application?.label !== "string" ||
      !Number.isInteger(application?.processId) ||
      application.processId <= 0
    ) {
      return [];
    }
    const processIds = Array.isArray(application.processIds)
      ? [...new Set(application.processIds.filter((pid) => Number.isInteger(pid) && pid > 0))].sort(
          (a, b) => a - b
        )
      : [application.processId];
    return [
      { ...application, processIds: processIds.length ? processIds : [application.processId] },
    ];
  });
}

function initialRequestedId() {
  const boot = typeof window !== "undefined" ? window.__PLVS_INITIAL_STATE__ : undefined;
  if (boot?.multiInstancePersistence) {
    if (typeof boot.captureDeviceId === "string") return boot.captureDeviceId;
    return "default";
  }
  return readCaptureDeviceIdFromLocalStorage();
}

function emptyInventory() {
  return {
    generation: 0,
    observedAt: new Date(0).toISOString(),
    automatic: { id: "default", label: "Automatic", available: false, resolved: null },
    devices: [],
    allDevices: [],
    captureApplications: [],
    truncated: false,
    signature: "",
    requestedId: initialRequestedId(),
    migrationState: null,
    inventoryReady: false,
  };
}

/**
 * Shared owner for device inventory, Automatic preview, persisted selection, and legacy migration.
 * GUI, tray, engine runtime, and Agent Control all consume this one coherent controller.
 * @param {{ liveLifecycle?: string, beginDeviceRestartForControl?: (...args: any[]) => any }} [options]
 */
export function useAudioDevices({
  liveLifecycle = "stopped",
  beginDeviceRestartForControl = null,
} = {}) {
  const [snapshot, setSnapshot] = useState(emptyInventory);
  const snapshotRef = useRef(snapshot);
  const refreshSequenceRef = useRef(0);
  const applicationRefreshSequenceRef = useRef(0);
  const migrationSequenceRef = useRef(0);
  const selectionSequenceRef = useRef(0);
  const userPreviewRef = useRef(null);
  const pendingSaveRef = useRef(Promise.resolve());
  const savedDeviceIdRef = useRef(snapshot.requestedId);
  const liveLifecycleRef = useRef(liveLifecycle);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    liveLifecycleRef.current = liveLifecycle;
  }, [liveLifecycle]);

  const publish = useCallback((next) => {
    snapshotRef.current = next;
    if (mountedRef.current) setSnapshot(next);
  }, []);

  const updateSnapshot = useCallback(
    (updater) => {
      publish(updater(snapshotRef.current));
    },
    [publish]
  );

  const commitCaptureDevice = useCallback(
    async (/** @type {string} */ nextId, options = {}) => {
      const sequence = options.selectionSequence ?? ++selectionSequenceRef.current;
      const current = snapshotRef.current;
      if (!mountedRef.current || sequence !== selectionSequenceRef.current) {
        return { changed: false, requestedId: current.requestedId };
      }
      const changed = current.requestedId !== nextId;
      if (changed) {
        publish({
          ...current,
          requestedId: nextId,
          migrationState: options.migrationState ?? null,
        });
      }
      const saved = pendingSaveRef.current.then(async () => {
        if (savedDeviceIdRef.current === nextId) return;
        await saveCaptureDeviceId(nextId);
        savedDeviceIdRef.current = nextId;
      });
      pendingSaveRef.current = saved.catch(() => {});
      try {
        await saved;
        if (snapshotRef.current.requestedId === nextId && snapshotRef.current.migrationState) {
          updateSnapshot((latest) => ({ ...latest, migrationState: null }));
        }
        return { changed, requestedId: nextId };
      } catch (error) {
        if (snapshotRef.current.requestedId === nextId) {
          updateSnapshot((latest) => ({
            ...latest,
            migrationState: options.migrationState
              ? { ...options.migrationState, state: "failed" }
              : null,
          }));
        }
        const failure = /** @type {Error & { stateCommitted?: boolean }} */ (
          error instanceof Error ? error : new Error(String(error))
        );
        failure.stateCommitted = true;
        throw failure;
      }
    },
    [publish, updateSnapshot]
  );

  const retryCaptureDevicePersistence = useCallback(
    (/** @type {string} */ id) => {
      if (snapshotRef.current.requestedId !== id || savedDeviceIdRef.current === id) return;
      return commitCaptureDevice(id, { selectionSequence: selectionSequenceRef.current });
    },
    [commitCaptureDevice]
  );

  const previewSelection = useCallback(async (/** @type {string} */ deviceId) => {
    if (isSourceMixId(deviceId)) {
      const mix = readSourceMixes(sourceMixesStore.read()).find(({ id }) => id === deviceId);
      if (!mix) throw new Error("Selected Mix Unavailable");
      return { label: mix.name, sampleRateHz: 48_000, channels: 2 };
    }
    if (/^app-[0-9a-f]{32}$/.test(deviceId)) {
      const application = snapshotRef.current.captureApplications.find(
        (candidate) => candidate.id === deviceId
      );
      if (!application) throw new Error("Capture application is not currently running.");
      const outputFormat = snapshotRef.current.automatic.resolved;
      return {
        label: application.label,
        sampleRateHz: outputFormat?.sampleRateHz ?? 48_000,
        channels: [1, 2, 6, 8].includes(outputFormat?.channelCount) ? outputFormat.channelCount : 2,
      };
    }
    return previewAudioDevice(deviceId);
  }, []);

  const selectCaptureDevice = useCallback(
    async (/** @type {string} */ nextId, options = {}) => {
      const selectionSequence = options.selectionSequence ?? ++selectionSequenceRef.current;
      const migrating = Boolean(options.migrationState);
      const current = () =>
        mountedRef.current && selectionSequence === selectionSequenceRef.current;
      const unchanged = () => ({ changed: false, requestedId: snapshotRef.current.requestedId });
      const assertStableLifecycle = () => {
        const lifecycle = liveLifecycleRef.current;
        if (!["starting", "stopping"].includes(lifecycle)) return;
        const error = /** @type {Error & { code?: string }} */ (
          new Error(`LIVE transport is ${lifecycle}.`)
        );
        error.code = "transitionInProgress";
        throw error;
      };
      if (!current() || (migrating && userPreviewRef.current === selectionSequence)) {
        return unchanged();
      }
      if (snapshotRef.current.requestedId === nextId) {
        return commitCaptureDevice(nextId, { ...options, selectionSequence });
      }
      assertStableLifecycle();

      if (!migrating) userPreviewRef.current = selectionSequence;
      try {
        await previewSelection(nextId);
      } catch (error) {
        if (!current()) return unchanged();
        if (nextId !== "default" || liveLifecycleRef.current === "running") {
          const failure = /** @type {Error & { code?: string }} */ (
            error instanceof Error ? error : new Error(String(error))
          );
          failure.code = "deviceUnavailable";
          throw failure;
        }
      } finally {
        if (!migrating && userPreviewRef.current === selectionSequence) {
          userPreviewRef.current = null;
        }
      }

      if (
        !current() ||
        (options.migrationState && snapshotRef.current.migrationState !== options.migrationState)
      ) {
        return unchanged();
      }
      assertStableLifecycle();
      if (snapshotRef.current.requestedId === nextId) return unchanged();

      const restart =
        liveLifecycleRef.current === "running" && beginDeviceRestartForControl
          ? beginDeviceRestartForControl()
          : null;
      const restartSettlement = restart
        ? restart.then(
            () => null,
            (error) => error
          )
        : null;
      let committed;
      let persistenceError = null;
      try {
        committed = await commitCaptureDevice(nextId, { ...options, selectionSequence });
      } catch (error) {
        persistenceError = error;
      }
      let restartError = null;
      if (restartSettlement) restartError = await restartSettlement;
      if (persistenceError) throw persistenceError;
      if (restartError) throw restartError;
      return committed;
    },
    [beginDeviceRestartForControl, commitCaptureDevice, previewSelection]
  );

  const refreshInventory = useCallback(
    async (providedDevices) => {
      if (!isTauri()) return snapshotRef.current;
      const sequence = ++refreshSequenceRef.current;
      const applicationSequence = ++applicationRefreshSequenceRef.current;
      const [devices, applications, preview] = await Promise.allSettled([
        providedDevices ?? listAudioDevices(),
        listCaptureApplications(),
        previewAudioDevice("default"),
      ]);
      if (!mountedRef.current || sequence !== refreshSequenceRef.current) {
        return snapshotRef.current;
      }
      const previous = snapshotRef.current;
      const resolved = previous.automatic.resolved;
      const automaticPreview =
        preview.status === "fulfilled"
          ? preview.value
          : resolved && { ...resolved, channels: resolved.channelCount };
      const receivedDevices = devices.status === "fulfilled" && Array.isArray(devices.value);
      const advanced = receivedDevices
        ? advanceDeviceGeneration(
            previous,
            normalizeDeviceInventory(devices.value, automaticPreview)
          )
        : previous;
      const { requestedId, migrationState } = previous;
      const next = {
        ...advanced,
        captureApplications:
          applications.status === "fulfilled" &&
          Array.isArray(applications.value) &&
          applicationSequence === applicationRefreshSequenceRef.current
            ? normalizeCaptureApplications(applications.value)
            : previous.captureApplications,
        requestedId,
        migrationState:
          migrationState?.requestedId === requestedId &&
          advanced.allDevices.some((device) => device.id === requestedId)
            ? null
            : migrationState,
        inventoryReady: receivedDevices || previous.inventoryReady,
      };
      publish(next);
      return next;
    },
    [publish]
  );

  const refreshCaptureApplications = useCallback(async () => {
    if (!isTauri()) return snapshotRef.current.captureApplications;
    const sequence = ++applicationRefreshSequenceRef.current;
    let applications;
    try {
      applications = await listCaptureApplications();
    } catch (_) {
      return snapshotRef.current.captureApplications;
    }
    if (!mountedRef.current || sequence !== applicationRefreshSequenceRef.current) {
      return snapshotRef.current.captureApplications;
    }
    const normalized = normalizeCaptureApplications(applications);
    updateSnapshot((current) => ({ ...current, captureApplications: normalized }));
    return normalized;
  }, [updateSnapshot]);

  useEffect(() => {
    mountedRef.current = true;
    if (!isTauri()) return () => void (mountedRef.current = false);
    let disposed = false;
    let unlisten = () => {};
    void refreshInventory();
    void onDeviceListChanged((devices) => {
      if (!disposed) void refreshInventory(Array.isArray(devices) ? devices : undefined);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      mountedRef.current = false;
      refreshSequenceRef.current += 1;
      applicationRefreshSequenceRef.current += 1;
      migrationSequenceRef.current += 1;
      selectionSequenceRef.current += 1;
      unlisten();
    };
  }, [refreshInventory]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const sequence = selectionSequenceRef.current;
    void loadCaptureDeviceId().then((requestedId) => {
      if (!cancelled && mountedRef.current && sequence === selectionSequenceRef.current) {
        const loadedId = requestedId || "default";
        savedDeviceIdRef.current = loadedId;
        updateSnapshot((current) =>
          current.requestedId === loadedId
            ? current
            : { ...current, requestedId: loadedId, migrationState: null }
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [updateSnapshot]);

  useEffect(() => {
    if (
      !isTauri() ||
      (!/^app-[0-9a-f]{32}$/.test(snapshot.requestedId) && !isSourceMixId(snapshot.requestedId))
    )
      return;
    const interval = window.setInterval(
      () => void refreshCaptureApplications(),
      APPLICATION_REFRESH_INTERVAL_MS
    );
    return () => window.clearInterval(interval);
  }, [refreshCaptureApplications, snapshot.requestedId]);

  useEffect(() => {
    if (!isTauri() || !snapshot.inventoryReady || snapshot.requestedId === "default") return;
    // Application IDs are stable identities rather than device endpoints. Preserve an application
    // selection while it is not running so the same selection can rebind to its next PID.
    if (
      /^app-[0-9a-f]{32}$/.test(snapshot.requestedId) ||
      isSourceMixId(snapshot.requestedId) ||
      splitChannelSource(snapshot.requestedId)
    )
      return;
    if (
      snapshot.allDevices.some((device) => device.id === snapshot.requestedId) ||
      snapshot.captureApplications.some((application) => application.id === snapshot.requestedId)
    )
      return;
    if (snapshot.migrationState?.state === "migrating") return;
    if (
      snapshot.migrationState?.state === "failed" &&
      snapshot.migrationState.requestedId === snapshot.requestedId &&
      snapshot.migrationState.generation === snapshot.generation
    )
      return;
    const { requestedId, generation } = snapshot;
    const sequence = ++migrationSequenceRef.current;
    const selectionSequence = selectionSequenceRef.current;
    const migrationState = { state: "migrating", requestedId, generation };
    const stillSelected = () =>
      mountedRef.current &&
      sequence === migrationSequenceRef.current &&
      snapshotRef.current.requestedId === requestedId &&
      snapshotRef.current.migrationState === migrationState;
    const finishUnresolved = () => {
      if (stillSelected()) {
        updateSnapshot((current) => ({
          ...current,
          migrationState: { ...migrationState, state: "failed" },
        }));
      }
    };
    updateSnapshot((current) => ({
      ...current,
      migrationState,
    }));
    void migrateCaptureDeviceId(requestedId).then(async (migratedId) => {
      if (!stillSelected()) return;
      if (!migratedId || migratedId === requestedId) {
        finishUnresolved();
        return;
      }
      try {
        const result = await selectCaptureDevice(migratedId, { migrationState, selectionSequence });
        if (!result.changed) finishUnresolved();
      } catch (_) {
        finishUnresolved();
      }
    }, finishUnresolved);
  }, [selectCaptureDevice, snapshot, updateSnapshot]);

  const audioDevices = useMemo(
    () =>
      snapshot.allDevices.map((device) => ({
        id: device.id,
        label: device.label,
        isSystemOutputMonitor: device.kind === "systemOutput",
        isLoopback: device.loopback,
        defaultSampleRate: device.sampleRateHz,
        channels: device.channelCount,
        ...(device.channelSelectors ? { channelSelectors: device.channelSelectors } : {}),
        ...(device.monitorSignature ? { monitorSignature: device.monitorSignature } : {}),
      })),
    [snapshot.allDevices]
  );

  return {
    snapshot,
    audioDevices,
    captureApplications: snapshot.captureApplications,
    captureDeviceId: snapshot.requestedId,
    safeAudioDeviceId: snapshot.requestedId,
    selectCaptureDevice,
    commitCaptureDevice,
    retryCaptureDevicePersistence,
    previewSelection,
    refreshInventory,
    refreshCaptureApplications,
    // Endpoint identity distinguishes outputs with the same label and format.
    defaultOutputFormatSig: snapshot.automatic.resolved
      ? JSON.stringify(snapshot.automatic.resolved)
      : "",
    defaultOutputLabel: snapshot.automatic.resolved?.label ?? "",
  };
}
