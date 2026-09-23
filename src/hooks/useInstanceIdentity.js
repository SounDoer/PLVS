import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";
import { setCoordinatorRole } from "../lib/runtimeRole.js";

const HEARTBEAT_MS = 2000;

export function useInstanceIdentity({ sourceLabel, running }) {
  useEffect(() => {
    if (!isTauri()) return undefined;
    const appWindow = getCurrentWindow();
    const appName = window.__PLVS_INITIAL_STATE__?.agentControl?.appName || "PLVS";
    let disposed = false;
    let publishing = false;
    let focusSequence = 0;

    async function publish() {
      if (disposed || publishing) return;
      publishing = true;
      try {
        const [visible, focused] = await Promise.all([
          appWindow.isVisible(),
          appWindow.isFocused(),
        ]);
        if (focused) focusSequence = Date.now();
        const published = await invoke("runtime_publish_instance_state", {
          update: {
            sourceLabel: sourceLabel || null,
            captureStatus: running ? "running" : "stopped",
            visible,
            focusSequence,
          },
        });
        if (!disposed) {
          setCoordinatorRole(published.isCoordinator);
          await appWindow.setTitle(`${appName} — ${published.displayName}`);
        }
      } catch (error) {
        if (!disposed) console.warn("Unable to publish PLVS instance state", error);
      } finally {
        publishing = false;
      }
    }

    void publish();
    const timer = setInterval(publish, HEARTBEAT_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [running, sourceLabel]);
}
