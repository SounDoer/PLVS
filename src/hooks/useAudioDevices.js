import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  advanceDeviceGeneration,
  normalizeDeviceInventory,
} from "../agentControl/deviceControl.js";
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
    requestedId: readCaptureDeviceIdFromLocalStorage(),
    migrationState: null,
    inventoryReady: false,
  };
}

/**
 * Shared owner for device inventory, Automatic preview, persisted selection, and legacy migration.
 * GUI, tray, engine runtime, and Agent Control all consume this one coherent controller.
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
  const mountedRef = useRef(true);

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
    async (nextId, options = {}) => {
      const current = snapshotRef.current;
      if (current.requestedId === nextId) {
        if (options.migrationState && current.migrationState !== null) {
          updateSnapshot((latest) => ({ ...latest, migrationState: null }));
        }
        return { changed: false, requestedId: nextId };
      }
      selectionSequenceRef.current += 1;
      publish({
        ...current,
        requestedId: nextId,
        migrationState: options.migrationState ?? null,
      });
      try {
        await saveCaptureDeviceId(nextId);
        if (snapshotRef.current.requestedId === nextId) {
          updateSnapshot((latest) => ({ ...latest, migrationState: null }));
        }
        return { changed: true, requestedId: nextId };
      } catch (error) {
        if (snapshotRef.current.requestedId === nextId) {
          updateSnapshot((latest) => ({
            ...latest,
            migrationState: options.migrationState
              ? { state: "failed", requestedId: options.migrationState.requestedId }
              : null,
          }));
        }
        const failure = error instanceof Error ? error : new Error(String(error));
        failure.stateCommitted = true;
        throw failure;
      }
    },
    [publish, updateSnapshot]
  );

  const previewSelection = useCallback(async (deviceId) => {
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
    async (nextId, options = {}) => {
      if (snapshotRef.current.requestedId === nextId) {
        return commitCaptureDevice(nextId, options);
      }
      if (["starting", "stopping"].includes(liveLifecycle)) {
        const error = new Error(`LIVE transport is ${liveLifecycle}.`);
        error.code = "transitionInProgress";
        throw error;
      }

      try {
        await previewSelection(nextId);
      } catch (error) {
        if (nextId !== "default" || liveLifecycle === "running") {
          const failure = error instanceof Error ? error : new Error(String(error));
          failure.code = "deviceUnavailable";
          throw failure;
        }
      }

      const restart =
        liveLifecycle === "running" && beginDeviceRestartForControl
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
        committed = await commitCaptureDevice(nextId, options);
      } catch (error) {
        persistenceError = error;
      }
      let restartError = null;
      if (restartSettlement) restartError = await restartSettlement;
      if (persistenceError) throw persistenceError;
      if (restartError) throw restartError;
      return committed;
    },
    [beginDeviceRestartForControl, commitCaptureDevice, liveLifecycle, previewSelection]
  );

  const refreshInventory = useCallback(
    async (providedDevices) => {
      if (!isTauri()) return snapshotRef.current;
      const sequence = ++refreshSequenceRef.current;
      let devices;
      let captureApplications;
      try {
        [devices, captureApplications] = await Promise.all([
          providedDevices === undefined ? listAudioDevices() : providedDevices,
          listCaptureApplications().catch(() => []),
        ]);
      } catch (_) {
        devices = [];
        captureApplications = [];
      }
      let automaticPreview = null;
      try {
        automaticPreview = await previewAudioDevice("default");
      } catch (_) {}
      if (!mountedRef.current || sequence !== refreshSequenceRef.current) {
        return snapshotRef.current;
      }
      const normalized = normalizeDeviceInventory(
        Array.isArray(devices) ? devices : [],
        automaticPreview,
        new Date()
      );
      const advanced = advanceDeviceGeneration(snapshotRef.current, normalized);
      const next = {
        ...advanced,
        captureApplications: normalizeCaptureApplications(captureApplications),
        requestedId: snapshotRef.current.requestedId,
        migrationState: snapshotRef.current.migrationState,
        inventoryReady: true,
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
      if (!disposed) void refreshInventory(Array.isArray(devices) ? devices : []);
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
      unlisten();
    };
  }, [refreshInventory]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const sequence = selectionSequenceRef.current;
    void loadCaptureDeviceId().then((requestedId) => {
      if (!cancelled && mountedRef.current && sequence === selectionSequenceRef.current) {
        updateSnapshot((current) => ({ ...current, requestedId }));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [updateSnapshot]);

  useEffect(() => {
    if (!isTauri() || !/^app-[0-9a-f]{32}$/.test(snapshot.requestedId)) return;
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
    if (/^app-[0-9a-f]{32}$/.test(snapshot.requestedId)) return;
    if (
      snapshot.allDevices.some((device) => device.id === snapshot.requestedId) ||
      snapshot.captureApplications.some((application) => application.id === snapshot.requestedId)
    )
      return;
    if (snapshot.migrationState?.state === "migrating") return;
    if (
      snapshot.migrationState?.state === "failed" &&
      snapshot.migrationState.requestedId === snapshot.requestedId
    )
      return;
    const requestedId = snapshot.requestedId;
    const sequence = ++migrationSequenceRef.current;
    updateSnapshot((current) => ({
      ...current,
      migrationState: { state: "migrating", requestedId },
    }));
    void migrateCaptureDeviceId(requestedId).then(
      async (migratedId) => {
        if (
          !mountedRef.current ||
          sequence !== migrationSequenceRef.current ||
          snapshotRef.current.requestedId !== requestedId
        )
          return;
        const nextId = typeof migratedId === "string" && migratedId ? migratedId : "default";
        try {
          await selectCaptureDevice(nextId, {
            migrationState: { state: "migrating", requestedId },
          });
        } catch (_) {}
      },
      () => {
        if (mountedRef.current && sequence === migrationSequenceRef.current) {
          updateSnapshot((current) => ({
            ...current,
            migrationState: { state: "failed", requestedId },
          }));
        }
      }
    );
  }, [selectCaptureDevice, snapshot, updateSnapshot]);

  const safeAudioDeviceId = useMemo(() => {
    const allowed = new Set([
      "default",
      ...snapshot.allDevices.map((device) => device.id),
      ...snapshot.captureApplications.map((application) => application.id),
    ]);
    return allowed.has(snapshot.requestedId) ? snapshot.requestedId : "default";
  }, [snapshot.allDevices, snapshot.captureApplications, snapshot.requestedId]);

  const audioDevices = useMemo(
    () =>
      snapshot.allDevices.map((device) => ({
        id: device.id,
        label: device.label,
        isSystemOutputMonitor: device.kind === "systemOutput",
        isLoopback: device.loopback,
        defaultSampleRate: device.sampleRateHz,
        channels: device.channelCount,
      })),
    [snapshot.allDevices]
  );

  return {
    snapshot,
    audioDevices,
    captureApplications: snapshot.captureApplications,
    captureDeviceId: snapshot.requestedId,
    safeAudioDeviceId,
    selectCaptureDevice,
    commitCaptureDevice,
    setCaptureDeviceIdAndPersist: selectCaptureDevice,
    previewSelection,
    refreshInventory,
    refreshCaptureApplications,
    // The label belongs in the signature: switching the system default between two outputs with
    // the same format must still restart Automatic capture onto the new device.
    defaultOutputFormatSig: snapshot.automatic.resolved
      ? `${snapshot.automatic.resolved.label}|${snapshot.automatic.resolved.channelCount}:${snapshot.automatic.resolved.sampleRateHz}`
      : "",
    defaultOutputLabel: snapshot.automatic.resolved?.label ?? "",
  };
}
