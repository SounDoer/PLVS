import { useCallback, useLayoutEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";
import { setCoordinatorRole } from "../lib/runtimeRole.js";

const HEARTBEAT_MS = 2000;

export function useInstanceIdentity({ sourceLabel, running, trayState = null }) {
  const trayKey = JSON.stringify(trayState);
  const focusSequence = useRef(0);
  const publisher = useRef(/** @type {(() => Promise<void>) | null} */ (null));
  const pending = useRef(/** @type {Promise<void> | null} */ (null));
  const publishNow = useCallback(async () => {
    // Explicit requests must publish after any in-flight heartbeat. An older write can
    // otherwise land after the window operation and overwrite the current visibility.
    const request = (pending.current ?? Promise.resolve()).then(async () => {
      await publisher.current?.();
    });
    pending.current = request;
    try {
      await request;
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    if (!isTauri()) return undefined;
    const appWindow = getCurrentWindow();
    const appName = window.__PLVS_INITIAL_STATE__?.agentControl?.appName || "PLVS";
    let disposed = false;

    async function publish() {
      try {
        const [visible, focused] = await Promise.all([
          appWindow.isVisible(),
          appWindow.isFocused(),
        ]);
        if (disposed) return;
        if (focused) focusSequence.current = Date.now();
        const published = await invoke("runtime_publish_instance_state", {
          update: {
            sourceLabel: sourceLabel || null,
            captureStatus: running ? "running" : "stopped",
            visible,
            focusSequence: focusSequence.current,
            trayState: JSON.parse(trayKey),
          },
        });
        if (!disposed) {
          setCoordinatorRole(published.isCoordinator);
          await appWindow.setTitle(`${appName} — ${published.displayName}`);
        }
      } catch (error) {
        if (!disposed) console.warn("Unable to publish PLVS instance state", error);
      }
    }

    publisher.current = publish;
    void publishNow();
    const timer = setInterval(() => {
      if (!pending.current) void publishNow();
    }, HEARTBEAT_MS);
    return () => {
      disposed = true;
      publisher.current = null;
      clearInterval(timer);
    };
  }, [publishNow, running, sourceLabel, trayKey]);
  return publishNow;
}
