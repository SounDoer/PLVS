import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import { isTauri } from "../ipc/env.js";
import { flushPersistence, settingsStore } from "../persistence/index.js";
import { quitCurrentWorkbench } from "../runtime/coordination.js";

const PERSISTENCE_ERROR =
  "PLVS couldn't save your latest settings. The window was left open so you can retry or cancel.";
const HIDE_ERROR = "PLVS couldn't hide the window. You can retry or cancel.";
const QUIT_ERROR = "PLVS couldn't quit. You can retry or cancel.";
const NOOP_ASYNC = async () => {};

export function useCloseConfirm({ onHideWindow, onShowWindow = NOOP_ASYNC, closeBlocked = false }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [closeError, setCloseError] = useState(null);
  const [closing, setClosing] = useState(false);
  const closeBlockedRef = useRef(closeBlocked);
  const closingRef = useRef(false);
  const pendingActionRef = useRef(null);
  const developmentFixtureIdRef = useRef(null);
  useLayoutEffect(() => {
    closeBlockedRef.current = closeBlocked;
  }, [closeBlocked]);

  const requestCloseAction = useCallback(
    async (/** @type {string} */ action, dontAskAgain = false) => {
      if (closeBlockedRef.current || closingRef.current) return false;

      developmentFixtureIdRef.current = null;
      const pending = { action, dontAskAgain };
      pendingActionRef.current = pending;
      closingRef.current = true;
      setCloseError(null);
      setClosing(true);
      let failureMessage = PERSISTENCE_ERROR;
      const rememberChoice = async () => {
        if (!dontAskAgain) return;
        await settingsStore.persist({ closeAction: action });
        settingsStore.notifyLocal();
      };
      try {
        if (action === "quit" && isTauri()) {
          failureMessage = QUIT_ERROR;
          await quitCurrentWorkbench({
            beforeStop: async () => {
              failureMessage = PERSISTENCE_ERROR;
              await rememberChoice();
              failureMessage = QUIT_ERROR;
            },
            onSaveFailure: () => {
              failureMessage = PERSISTENCE_ERROR;
            },
          });
        } else {
          await rememberChoice();
          await flushPersistence();
          failureMessage = action === "tray" ? HIDE_ERROR : QUIT_ERROR;
          if (action === "tray") await onHideWindow();
          else await exit(0);
        }
        setDialogOpen(false);
        pendingActionRef.current = null;
        return true;
      } catch (error) {
        if (error?.code === "editorActive") failureMessage = error.message;
        console.error(failureMessage, error);
        await onShowWindow().catch((showError) => {
          console.error("Failed to reveal the close error", showError);
        });
        setCloseError(failureMessage);
        setDialogOpen(true);
        return false;
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
    let disposed = false;
    getCurrentWindow()
      .onCloseRequested(async (e) => {
        if (disposed) return;
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
        developmentFixtureIdRef.current = null;
        setCloseError(null);
        setDialogOpen(true);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((error) => {
        if (!disposed) console.error("Unable to listen for window close requests", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [requestCloseAction]);

  /**
   * @param {boolean} dontAskAgain
   */
  async function handleConfirm(action, dontAskAgain) {
    await requestCloseAction(action, dontAskAgain);
  }

  async function handleRetry() {
    const pending = pendingActionRef.current;
    if (pending) await requestCloseAction(pending.action, pending.dontAskAgain);
  }

  function handleCancel() {
    pendingActionRef.current = null;
    developmentFixtureIdRef.current = null;
    setCloseError(null);
    setDialogOpen(false);
  }

  const developmentFixture = {
    establish(fixtureId) {
      developmentFixtureIdRef.current = fixtureId;
      pendingActionRef.current = null;
      setCloseError(null);
      setDialogOpen(true);
    },
    matches(fixtureId) {
      return dialogOpen && developmentFixtureIdRef.current === fixtureId;
    },
    reset(fixtureId) {
      if (developmentFixtureIdRef.current !== fixtureId) return;
      developmentFixtureIdRef.current = null;
      pendingActionRef.current = null;
      setCloseError(null);
      setDialogOpen(false);
    },
  };

  return {
    dialogOpen,
    closeError,
    closing,
    handleConfirm,
    handleRetry,
    handleCancel,
    requestCloseAction,
    developmentFixture,
  };
}
