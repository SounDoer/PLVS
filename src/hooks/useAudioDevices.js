import { useEffect, useState } from "react";
import { listAudioDevices, migrateCaptureDeviceId, previewAudioDevice } from "../ipc/commands.js";
import {
  loadCaptureDeviceId,
  readCaptureDeviceIdFromLocalStorage,
  saveCaptureDeviceId,
} from "../ipc/capturePrefs.js";
import { onDeviceListChanged } from "../ipc/events.js";
import { isTauri } from "../ipc/env.js";

/**
 * Tauri capture device list, persisted selection, default-route format signature, and migration when IDs change.
 */
export function useAudioDevices() {
  const [audioDevices, setAudioDevices] = useState([]);
  const [captureDeviceId, setCaptureDeviceId] = useState(() =>
    readCaptureDeviceIdFromLocalStorage()
  );
  const [defaultOutputFormatSig, setDefaultOutputFormatSig] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void previewAudioDevice("default").then(
      (p) => {
        if (cancelled || !p || !Number.isFinite(p.channels) || !Number.isFinite(p.sampleRateHz))
          return;
        setDefaultOutputFormatSig(`${p.channels}:${p.sampleRateHz}`);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [audioDevices]);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listAudioDevices();
        if (!cancelled) setAudioDevices(Array.isArray(list) ? list : []);
      } catch (_) {
        if (!cancelled) setAudioDevices([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void loadCaptureDeviceId().then((id) => {
      if (!cancelled) setCaptureDeviceId(id);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten = () => {};
    (async () => {
      const u = await onDeviceListChanged((list) => {
        if (!disposed) setAudioDevices(Array.isArray(list) ? list : []);
      });
      if (!disposed) unlisten = u;
      else u();
    })();
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  useEffect(() => {
    if (!isTauri() || !audioDevices.length) return;
    if (captureDeviceId === "default") return;
    if (audioDevices.some((d) => d.id === captureDeviceId)) return;
    let cancelled = false;
    void migrateCaptureDeviceId(captureDeviceId).then((newId) => {
      if (cancelled) return;
      if (typeof newId === "string" && newId.length > 0) {
        setCaptureDeviceId(newId);
        void saveCaptureDeviceId(newId);
        return;
      }
      setCaptureDeviceId("default");
      void saveCaptureDeviceId("default");
    });
    return () => {
      cancelled = true;
    };
  }, [audioDevices, captureDeviceId]);

  function setCaptureDeviceIdAndPersist(nextId) {
    setCaptureDeviceId(nextId);
    void saveCaptureDeviceId(nextId);
  }

  return {
    audioDevices,
    captureDeviceId,
    setCaptureDeviceId,
    setCaptureDeviceIdAndPersist,
    defaultOutputFormatSig,
  };
}
