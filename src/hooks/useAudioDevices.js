import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  advanceDeviceGeneration,
  normalizeDeviceInventory,
} from "../agentControl/deviceControl.js";
import { listAudioDevices, migrateCaptureDeviceId, previewAudioDevice } from "../ipc/commands.js";
import {
  loadCaptureDeviceId,
  readCaptureDeviceIdFromLocalStorage,
  saveCaptureDeviceId,
} from "../ipc/capturePrefs.js";
import { onDeviceListChanged } from "../ipc/events.js";
import { isTauri } from "../ipc/env.js";

function emptyInventory() {
  return {
    generation: 0,
    observedAt: new Date(0).toISOString(),
    automatic: { id: "default", label: "Automatic", available: false, resolved: null },
    devices: [],
    allDevices: [],
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

  const previewSelection = useCallback(async (deviceId) => previewAudioDevice(deviceId), []);

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
      try {
        devices = providedDevices === undefined ? await listAudioDevices() : providedDevices;
      } catch (_) {
        devices = [];
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
        requestedId: snapshotRef.current.requestedId,
        migrationState: snapshotRef.current.migrationState,
        inventoryReady: true,
      };
      publish(next);
      return next;
    },
    [publish]
  );

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
    if (!isTauri() || !snapshot.inventoryReady || snapshot.requestedId === "default") return;
    if (snapshot.allDevices.some((device) => device.id === snapshot.requestedId)) return;
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
    const allowed = new Set(["default", ...snapshot.allDevices.map((device) => device.id)]);
    return allowed.has(snapshot.requestedId) ? snapshot.requestedId : "default";
  }, [snapshot.allDevices, snapshot.requestedId]);

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
    captureDeviceId: snapshot.requestedId,
    safeAudioDeviceId,
    selectCaptureDevice,
    commitCaptureDevice,
    setCaptureDeviceIdAndPersist: selectCaptureDevice,
    previewSelection,
    refreshInventory,
    defaultOutputFormatSig: snapshot.automatic.resolved
      ? `${snapshot.automatic.resolved.channelCount}:${snapshot.automatic.resolved.sampleRateHz}`
      : "",
    defaultOutputLabel: snapshot.automatic.resolved?.label ?? "",
  };
}
