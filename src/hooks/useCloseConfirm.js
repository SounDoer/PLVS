import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import { isTauri } from "../ipc/env.js";
import { settingsStore } from "../persistence/index.js";

export function useCloseConfirm({ onHideWindow }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten;
    getCurrentWindow()
      .onCloseRequested(async (e) => {
        e.preventDefault();
        const saved = settingsStore.read().closeAction ?? null;
        if (saved === "tray") {
          await onHideWindow();
          return;
        }
        if (saved === "quit") {
          await exit(0);
          return;
        }
        setDialogOpen(true);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [onHideWindow]);

  async function handleConfirm(action, dontAskAgain) {
    setDialogOpen(false);
    if (dontAskAgain) {
      settingsStore.patch({ closeAction: action });
    }
    if (action === "tray") {
      await onHideWindow();
    } else {
      await exit(0);
    }
  }

  function handleCancel() {
    setDialogOpen(false);
  }

  return { dialogOpen, handleConfirm, handleCancel };
}
