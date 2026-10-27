import { useCallback, useEffect, useRef, useState } from "react";
import { useDock } from "./DockContext.jsx";
import { useDockAccessories } from "./DockAccessoriesContext.jsx";
import { useDockImportWindow } from "./useDockImportWindow.js";
import { listenDockAccessoryAction } from "../ipc/dockAccessoryEvents.js";
import { normalizeAccessoryAction } from "./accessoryProtocol.js";
import { isTauri } from "../ipc/env.js";
import { useAppLifecycle } from "../hooks/AppLifecycleContext.jsx";

export function DockImportSurface({ pack, settings, loudnessProfile, presets }) {
  const { docked, dockEdge, dockSuspended, exitDockRestoringAttributes } = useDock();
  const { setImportActive } = useDockAccessories();
  const { updateControls } = useAppLifecycle();
  const [requested, setRequested] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [sequence, setSequence] = useState(0);
  const latest = useRef(null);
  const handled = useRef(null);
  const accepting = useRef(false);
  const clearError = useRef(null);
  latest.current = { pack, docked, dockSuspended };
  const acceptPaste = useCallback((text) => {
    const current = latest.current;
    if (
      !current.docked ||
      current.dockSuspended ||
      accepting.current ||
      current.pack.busy ||
      current.pack.review ||
      current.pack.completion ||
      typeof text !== "string" ||
      !text
    )
      return;
    clearError.current?.();
    accepting.current = true;
    setStatusMessage("");
    setRequested(true);
    setSequence((value) => value + 1);
    void current.pack.beginPaste(text).finally(() => {
      accepting.current = false;
    });
  }, []);
  useEffect(() => {
    if (!docked || dockSuspended) return;
    const paste = (event) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable
      )
        return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      acceptPaste(text);
    };
    window.addEventListener("paste", paste);
    return () => window.removeEventListener("paste", paste);
  }, [docked, dockSuspended, acceptPaste]);
  useEffect(() => {
    if (!docked || dockSuspended || !isTauri()) return;
    let disposed = false;
    let unlisten;
    void listenDockAccessoryAction((raw) => {
      const event = normalizeAccessoryAction(raw);
      if (event?.type === "import-paste" && ["dock-header", "dock-editor"].includes(event.surface))
        acceptPaste(event.payload.text);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [docked, dockSuspended, acceptPaste]);
  useEffect(() => {
    if (!docked) {
      setRequested(false);
      setStatusMessage("");
    }
  }, [docked]);
  useEffect(() => {
    if (requested && !pack.busy && !pack.review && !pack.completion && pack.status) {
      setStatusMessage(pack.status);
    }
  }, [requested, pack.busy, pack.review, pack.completion, pack.status]);
  const mode = pack.review
    ? "review"
    : pack.completion
      ? "complete"
      : requested && statusMessage
        ? "status"
        : null;
  const updateOpen =
    Boolean(updateControls.details) ||
    (updateControls.enabled && !settings.updatePreferences.choiceMade);
  const visible = docked && !dockSuspended && Boolean(mode) && !updateOpen;
  const key = mode ? `${sequence}:${mode}` : null;
  const review = pack.review ?? pack.completion;
  const payload = {
    key,
    mode,
    review: review
      ? {
          type: review.type,
          itemPlan: review.itemPlan,
          profilePlan: review.profilePlan,
          warnings: review.warnings,
        }
      : null,
    status: mode === "status" ? statusMessage : pack.status,
    busy: pack.busy,
    interfaceSize: settings.interfaceSize,
  };
  useEffect(() => {
    setImportActive(docked && Boolean(mode));
    return () => setImportActive(false);
  }, [docked, mode, setImportActive]);
  const onGeometry = useCallback(() => {}, []);
  const dockWindow = useDockImportWindow({
    active: visible,
    prepare: visible,
    edge: dockEdge,
    payload,
    onGeometry,
    onAction: ({ type, payload: actionPayload }) => {
      if (actionPayload.key !== key || handled.current === key) return;
      if (type === "import-confirm" && mode === "review") {
        handled.current = key;
        // Parsing succeeded; subsequent status belongs to the completion flow, not paste errors.
        setRequested(false);
        setStatusMessage("");
        pack.confirmImport();
      } else if (type === "import-dismiss") {
        handled.current = key;
        if (mode === "review") pack.cancelImport();
        if (mode === "complete") pack.dismissCompletion();
        setRequested(false);
        setStatusMessage("");
      } else if (type === "import-action" && mode === "complete") {
        handled.current = key;
        void pack
          .runCompletionAction(async (type, id) => {
            if (type === "themes") {
              settings.setFixedThemeIdFromPicker(id);
              return true;
            }
            if (type === "loudness") {
              if (loudnessProfile.draftBlocksLibraryActions) return false;
              loudnessProfile.select(`profile:${id}`);
              return true;
            }
            return presets.apply(id);
          })
          .finally(() => {
            handled.current = null;
          });
      }
    },
  });
  clearError.current = dockWindow.clearError;
  useEffect(() => {
    if (docked && mode && dockWindow.error) void exitDockRestoringAttributes();
  }, [docked, mode, dockWindow.error, exitDockRestoringAttributes]);
  return null;
}
