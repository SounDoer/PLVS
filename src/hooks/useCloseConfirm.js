import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { isTauri } from "../ipc/env.js";
import { flushPersistence, settingsStore } from "../persistence/index.js";

const PERSISTENCE_ERROR =
  "PLVS couldn't save your latest settings. The window was left open so you can retry or cancel.";
const NOOP_ASYNC = async () => {};

export function useCloseConfirm({ onHideWindow, onShowWindow = NOOP_ASYNC, closeBlocked = false }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [closeError, setCloseError] = useState(null);
  const [closing, setClosing] = useState(false);
  const closeBlockedRef = useRef(closeBlocked);
  const closingRef = useRef(false);
  const pendingActionRef = useRef(null);
  useLayoutEffect(() => {
    closeBlockedRef.current = closeBlocked;
  }, [closeBlocked]);

  const requestCloseAction = useCallback(
    async (action, dontAskAgain = false) => {
      if (closeBlockedRef.current || closingRef.current) return false;

      const pending = { action, dontAskAgain };
      pendingActionRef.current = pending;
      closingRef.current = true;
      setCloseError(null);
      setClosing(true);
      try {
        try {
          if (dontAskAgain) {
            await settingsStore.persist({ closeAction: action });
          }
          await flushPersistence();
          if (action === "quit" && isTauri()) {
            await invoke("runtime_retire_current_workspace");
          }
        } catch (error) {
          console.error("Failed to flush persistence before closing PLVS", error);
          await onShowWindow().catch((showError) => {
            console.error("Failed to reveal the persistence error", showError);
          });
          setCloseError(PERSISTENCE_ERROR);
          setDialogOpen(true);
          return false;
        }
        setDialogOpen(false);
        pendingActionRef.current = null;
        if (action === "tray") {
          await onHideWindow();
        } else {
          await exit(0);
        }
        return true;
      } finally {
        closingRef.current = false;
        setClosing(false);
      }
    },
    [onHideWindow, onShowWindow]
  );

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten;
    getCurrentWindow()
      .onCloseRequested(async (e) => {
        e.preventDefault();
        if (closeBlockedRef.current) return;
        const saved = settingsStore.read().closeAction ?? null;
        if (saved === "tray") {
          await requestCloseAction("tray");
          return;
        }
        if (saved === "quit") {
          await requestCloseAction("quit");
          return;
        }
        setCloseError(null);
        setDialogOpen(true);
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [requestCloseAction]);

  async function handleConfirm(action, dontAskAgain) {
    await requestCloseAction(action, dontAskAgain);
  }

  async function handleRetry() {
    const pending = pendingActionRef.current;
    if (pending) await requestCloseAction(pending.action, pending.dontAskAgain);
  }

  function handleCancel() {
    pendingActionRef.current = null;
    setCloseError(null);
    setDialogOpen(false);
  }

  return {
    dialogOpen,
    closeError,
    closing,
    handleConfirm,
    handleRetry,
    handleCancel,
    requestCloseAction,
  };
}
